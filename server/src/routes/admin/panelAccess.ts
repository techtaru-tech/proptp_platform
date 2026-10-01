import { Router } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../../prisma';
import { hashPassword, type AuthedRequest } from '../../services/auth';
import { requireFullAccess } from './auth';
import { MODULES, getAdministratorRole, resolveAccess, sanitizeModules } from '../../services/permissions';
import { writeAudit } from '../../services/audit';
import { ROLE_LABEL, validateReporting } from '../../services/hierarchy';

/**
 * Roles and the panel users assigned to them. Everything here is behind `requireFullAccess`,
 * so a manager can neither see nor widen the permission model they are governed by.
 */
export const panelRolesRouter = Router();

/** The account roles a panel user may be created as. `leader` and `agent` also lead/join teams. */
const ACCOUNT_ROLES: UserRole[] = ['admin', 'employee', 'leader', 'team_leader', 'agent'];
export const panelUsersRouter = Router();

/** The module catalogue the Roles screen renders its checkboxes from. */
panelRolesRouter.get('/modules', (_req, res) => {
  res.json(MODULES);
});

panelRolesRouter.use(requireFullAccess);
panelUsersRouter.use(requireFullAccess);

panelRolesRouter.get('/', async (_req, res, next) => {
  try {
    await getAdministratorRole();
    const roles = await prisma.panelRole.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    });
    res.json(
      roles.map(({ _count, modules, ...role }) => ({
        ...role,
        modules: sanitizeModules(modules),
        userCount: _count.users,
      }))
    );
  } catch (err) {
    next(err);
  }
});

panelRolesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Role name is required.' });

    const modules = sanitizeModules(req.body?.modules);
    if (modules.length === 0) return res.status(400).json({ error: 'Select at least one module for this role.' });

    const clash = await prisma.panelRole.findUnique({ where: { name } });
    if (clash) return res.status(409).json({ error: `A role named "${name}" already exists.` });

    const created = await prisma.panelRole.create({
      data: {
        name,
        description: String(req.body?.description ?? '').trim() || null,
        // Full access is reserved for the built-in Administrator role — a new role is always
        // module-scoped, so this screen can't mint a second super admin by accident.
        isFullAccess: false,
        modules,
      },
    });

    await writeAudit(req, {
      module: 'Settings',
      action: 'Created panel role',
      recordId: created.id,
      recordLabel: created.name,
      description: `Role "${created.name}" created with ${modules.length} module(s).`,
    });
    res.status(201).json({ ...created, modules, userCount: 0 });
  } catch (err) {
    next(err);
  }
});

panelRolesRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.panelRole.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.isSystem) return res.status(400).json({ error: 'The built-in Administrator role cannot be edited.' });

    const data: { name?: string; description?: string | null; modules?: string[] } = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Role name is required.' });
      const clash = await prisma.panelRole.findFirst({ where: { name, id: { not: existing.id } } });
      if (clash) return res.status(409).json({ error: `A role named "${name}" already exists.` });
      data.name = name;
    }
    if (req.body?.description !== undefined) data.description = String(req.body.description).trim() || null;
    if (req.body?.modules !== undefined) {
      const modules = sanitizeModules(req.body.modules);
      if (modules.length === 0) return res.status(400).json({ error: 'Select at least one module for this role.' });
      data.modules = modules;
    }

    const updated = await prisma.panelRole.update({ where: { id: existing.id }, data: data as never });
    await writeAudit(req, {
      module: 'Settings',
      action: 'Updated panel role',
      recordId: updated.id,
      recordLabel: updated.name,
      description: `Role "${updated.name}" permissions were updated.`,
    });
    res.json({ ...updated, modules: sanitizeModules(updated.modules) });
  } catch (err) {
    next(err);
  }
});

panelRolesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.panelRole.findUnique({
      where: { id: String(req.params.id) },
      include: { _count: { select: { users: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.isSystem) return res.status(400).json({ error: 'The built-in Administrator role cannot be deleted.' });
    if (existing._count.users > 0) {
      return res.status(400).json({
        error: `${existing._count.users} user(s) still use this role. Move them to another role first.`,
      });
    }

    await prisma.panelRole.delete({ where: { id: existing.id } });
    await writeAudit(req, {
      module: 'Settings',
      action: 'Deleted panel role',
      recordId: existing.id,
      recordLabel: existing.name,
      description: `Role "${existing.name}" was deleted.`,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Panel users — the people who sign in to this admin panel.
// ---------------------------------------------------------------------------

const panelUserShape = (user: {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: string;
  role: string;
  avatarUrl: string | null;
  panelRoleId: string | null;
  panelRole?: { name: string; isFullAccess: boolean } | null;
  reportingLeaderId?: string | null;
  reportingLeader?: { name: string } | null;
  createdAt: Date;
}) => ({
  id: user.id,
  name: user.name,
  email: user.email ?? '',
  phone: user.phone,
  status: user.status,
  accountRole: user.role,
  avatarUrl: user.avatarUrl ?? undefined,
  panelRoleId: user.panelRoleId,
  roleName: user.panelRole?.name ?? 'Administrator',
  isFullAccess: user.panelRole?.isFullAccess ?? true,
  managerId: user.reportingLeaderId ?? null,
  managerName: user.reportingLeader?.name ?? null,
  createdAt: user.createdAt,
});

/** What a panel-user query loads so the list can show who each person reports to. */
const panelUserInclude = {
  panelRole: { select: { name: true, isFullAccess: true } },
  reportingLeader: { select: { name: true } },
} as const;

panelUsersRouter.get('/', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      // Panel access is "is an admin, or has been given a panel role" (see canUsePanel) — an
      // employee or agent who works in the panel belongs on this list too.
      where: { OR: [{ role: 'admin' }, { panelRoleId: { not: null } }], role: { not: 'vendor' } },
      orderBy: { createdAt: 'asc' },
      include: panelUserInclude,
    });
    res.json(users.map(panelUserShape));
  } catch (err) {
    next(err);
  }
});

panelUsersRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const phone = String(req.body?.phone ?? '').trim();
    const password = String(req.body?.password ?? '');
    const panelRoleId = String(req.body?.panelRoleId ?? '').trim();
    /**
     * The account role, which is a different question from the panel role: the panel role
     * decides which modules they see, this decides what they *are* — and modules like Tasks
     * scope what a person may read by it. Defaults to admin, which is what every panel user
     * was before this was a choice.
     */
    const accountRole = String(req.body?.accountRole ?? 'admin').trim() as UserRole;
    const managerId = String(req.body?.managerId ?? '').trim() || null;

    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid email address is required.' });
    if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'A 10-digit phone number is required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!panelRoleId) return res.status(400).json({ error: 'Select a role.' });
    if (!ACCOUNT_ROLES.includes(accountRole)) return res.status(400).json({ error: 'Unknown account role.' });
    // A Team Leader reports to a Leader, an Employee to a Team Leader, and so on — the same
    // placement rule everywhere somebody is put into the tree.
    const placement = await validateReporting(null, accountRole, managerId);
    if (placement) return res.status(400).json({ error: placement });

    const role = await prisma.panelRole.findUnique({ where: { id: panelRoleId } });
    if (!role) return res.status(400).json({ error: 'That role no longer exists.' });

    // Phone is the unique key on User, and an email already used by any account (partner or
    // panel) would make sign-in ambiguous.
    const phoneClash = await prisma.user.findUnique({ where: { phone } });
    if (phoneClash) return res.status(409).json({ error: 'That phone number already belongs to another account.' });
    const emailClash = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (emailClash) return res.status(409).json({ error: 'That email address already belongs to another account.' });

    const suffix = Date.now().toString(36).toUpperCase().slice(-6);
    const codePrefix = `SR-${accountRole.toUpperCase()}-`;
    const created = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        role: accountRole,
        status: 'active',
        passwordHash: await hashPassword(password),
        panelRoleId: role.id,
        reportingLeaderId: managerId,
        partnerCode: `${codePrefix}${suffix}`,
        referralCode: `${codePrefix}${suffix}`,
      },
      include: panelUserInclude,
    });

    await writeAudit(req, {
      module: 'Settings',
      action: 'Created panel user',
      recordId: created.id,
      recordLabel: created.name,
      description: `Panel user "${created.name}" created as ${ROLE_LABEL[accountRole]} with role "${role.name}"${created.reportingLeader ? `, reporting to ${created.reportingLeader.name}` : ''}.`,
    });
    res.status(201).json(panelUserShape(created));
  } catch (err) {
    next(err);
  }
});

panelUsersRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
    if (!existing || !(existing.role === 'admin' || existing.panelRoleId)) {
      return res.status(404).json({ error: 'Panel user not found' });
    }

    const data: Record<string, unknown> = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Name is required.' });
      data.name = name;
    }
    if (req.body?.panelRoleId !== undefined) {
      const role = await prisma.panelRole.findUnique({ where: { id: String(req.body.panelRoleId) } });
      if (!role) return res.status(400).json({ error: 'That role no longer exists.' });
      data.panelRoleId = role.id;
    }
    if (req.body?.status !== undefined) {
      const status = String(req.body.status);
      if (!['active', 'inactive', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
      // Locking yourself out of the panel is never what you meant to do.
      if (status !== 'active' && existing.id === (req as AuthedRequest).auth?.sub) {
        return res.status(400).json({ error: 'You cannot deactivate your own account.' });
      }
      data.status = status;
    }
    // Placement is validated as a pair — role and manager together — so neither can be changed
    // into a combination the tree does not allow. Admins sit outside the tree.
    if (req.body?.accountRole !== undefined || req.body?.managerId !== undefined) {
      const nextRole = (req.body?.accountRole ?? existing.role) as UserRole;
      if (!ACCOUNT_ROLES.includes(nextRole)) return res.status(400).json({ error: 'Unknown account role.' });
      const nextManager =
        req.body?.managerId === undefined ? existing.reportingLeaderId : String(req.body.managerId || '').trim() || null;
      const placement = await validateReporting(existing.id, nextRole, nextManager);
      if (placement) return res.status(400).json({ error: placement });
      data.role = nextRole;
      data.reportingLeaderId = nextManager;
    }
    if (req.body?.password) {
      const password = String(req.body.password);
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      data.passwordHash = await hashPassword(password);
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: data as never,
      include: panelUserInclude,
    });

    await writeAudit(req, {
      module: 'Settings',
      action: 'Updated panel user',
      recordId: updated.id,
      recordLabel: updated.name,
      description: `Panel user "${updated.name}" was updated.`,
    });
    res.json(panelUserShape(updated));
  } catch (err) {
    next(err);
  }
});

panelUsersRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
    if (!existing || !(existing.role === 'admin' || existing.panelRoleId)) {
      return res.status(404).json({ error: 'Panel user not found' });
    }
    if (existing.id === (req as AuthedRequest).auth?.sub) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const remainingFullAccess = await prisma.user.count({
      where: { role: 'admin', status: 'active', id: { not: existing.id }, OR: [{ panelRoleId: null }, { panelRole: { isFullAccess: true } }] },
    });
    if (remainingFullAccess === 0) {
      return res.status(400).json({ error: 'This is the last full-access administrator — create another before deleting this one.' });
    }

    await prisma.user.delete({ where: { id: existing.id } });
    await writeAudit(req, {
      module: 'Settings',
      action: 'Deleted panel user',
      recordId: existing.id,
      recordLabel: existing.name,
      description: `Panel user "${existing.name}" was deleted.`,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/** What the signed-in user may do — the frontend uses this to build the sidebar. */
panelUsersRouter.get('/me/access', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await resolveAccess(req.auth!.sub));
  } catch (err) {
    next(err);
  }
});
