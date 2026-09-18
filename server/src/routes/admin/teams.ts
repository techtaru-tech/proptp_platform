import { Router } from 'express';
import { prisma } from '../../prisma';
import { adminUser, ROLE_ID } from '../../services/adminMappers';

export const adminTeamsRouter = Router();

const teamShape = (team: { id: string; name: string; leaderId: string | null; createdAt: Date; members: { id: string }[] }) => ({
  id: team.id,
  name: team.name,
  leaderId: team.leaderId ?? '',
  memberIds: team.members.map((m) => m.id),
  createdAt: team.createdAt.toISOString(),
});

adminTeamsRouter.get('/', async (_req, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      include: { members: { select: { id: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ teams: teams.map(teamShape) });
  } catch (err) {
    next(err);
  }
});

adminTeamsRouter.get('/:id', async (req, res, next) => {
  try {
    const team = await prisma.team.findUnique({
      where: { id: String(req.params.id) },
      include: { members: { select: { id: true } } },
    });
    if (!team) return res.status(404).json({ error: 'Team not found' });
    res.json(teamShape(team));
  } catch (err) {
    next(err);
  }
});

adminTeamsRouter.get('/:id/members', async (req, res, next) => {
  try {
    const members = await prisma.user.findMany({
      where: { teamId: String(req.params.id) },
      include: { bankAccounts: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json({ members: members.map((m) => adminUser(m)) });
  } catch (err) {
    next(err);
  }
});

interface TreeNode {
  userId: string;
  name: string;
  role: number;
  status: string;
  teamSize: number;
  children: TreeNode[];
}

/**
 * The downline tree under a leader. Built with one query per depth level rather than a
 * recursive per-node query, and depth-capped so a mis-entered sponsor cycle cannot hang
 * the request.
 */
adminTeamsRouter.get('/tree/:leaderId', async (req, res, next) => {
  try {
    const rootId = String(req.params.leaderId);
    const root = await prisma.user.findUnique({ where: { id: rootId } });
    if (!root) return res.status(404).json({ error: 'Leader not found' });

    const MAX_DEPTH = 5;
    const byParent = new Map<string, TreeNode[]>();
    const seen = new Set<string>([rootId]);
    let frontier = [rootId];

    for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
      const children = await prisma.user.findMany({
        where: {
          OR: [{ sponsorId: { in: frontier } }, { reportingLeaderId: { in: frontier } }],
          id: { notIn: [...seen] },
        },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      });
      if (children.length === 0) break;
      for (const child of children) {
        seen.add(child.id);
        const parentId = child.reportingLeaderId ?? child.sponsorId ?? rootId;
        const node: TreeNode = {
          userId: child.id,
          name: child.name,
          role: ROLE_ID[child.role],
          status: child.status,
          teamSize: 0,
          children: [],
        };
        byParent.set(parentId, [...(byParent.get(parentId) ?? []), node]);
      }
      frontier = children.map((c) => c.id);
    }

    // Stitch parents to children and roll `teamSize` up from the leaves.
    const attach = (node: TreeNode): number => {
      node.children = byParent.get(node.userId) ?? [];
      node.teamSize = node.children.reduce((sum, child) => sum + 1 + attach(child), 0);
      return node.teamSize;
    };
    const tree: TreeNode = {
      userId: root.id,
      name: root.name,
      role: ROLE_ID[root.role],
      status: root.status,
      teamSize: 0,
      children: [],
    };
    attach(tree);

    res.json(tree);
  } catch (err) {
    next(err);
  }
});
