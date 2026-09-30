import { useStore } from '@nanostores/react';
import { harnessState, type HarnessPhase } from '~/lib/stores/harness';
import styles from '~/components/chat/ChatExperience.module.scss';

const phaseOrder: HarnessPhase[] = ['planning', 'awaiting-approval', 'preparing-assets', 'editing', 'verifying', 'verified'];
const roles = [
  { name: 'Manager', icon: 'i-ph:blueprint', phases: ['planning', 'awaiting-approval'] },
  { name: 'Editor', icon: 'i-ph:code', phases: ['preparing-assets', 'editing'] },
  { name: 'Verifier', icon: 'i-ph:shield-check', phases: ['verifying', 'verified'] },
];

export function AgentPipeline() {
  const state = useStore(harnessState);
  const current = phaseOrder.indexOf(state.phase);

  return (
    <div className={styles.Pipeline} aria-label="Agent pipeline">
      {roles.map((role) => {
        const active = role.phases.includes(state.phase);
        const complete = current > phaseOrder.indexOf(role.phases[role.phases.length - 1] as HarnessPhase) || state.phase === 'verified';

        return <div key={role.name} data-active={active} data-complete={complete}><span className={complete ? 'i-ph:check-circle' : role.icon} aria-hidden="true" /><span>{role.name}</span>{active && state.phase !== 'awaiting-approval' && state.phase !== 'verified' && <span className="i-svg-spinners:90-ring-with-bg" aria-hidden="true" />}</div>;
      })}
    </div>
  );
}
