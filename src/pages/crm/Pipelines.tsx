import { PageHeader } from '../../components/ui/PageHeader';
import { PipelineManager } from './PipelineManager';

/** CRM -> Pipeline: create and manage pipelines/stages. The drag-drop board lives on its
 * own "Kanban" nav item right below this one. */
export function Pipelines() {
  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Create and manage pipelines and their stages."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Pipeline' }]}
      />
      <PipelineManager />
    </div>
  );
}
