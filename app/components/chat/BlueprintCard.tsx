import { memo, useId, useState } from 'react';
import type { Blueprint } from '~/lib/harness/blueprint';
import styles from '~/components/chat/ChatExperience.module.scss';

interface BlueprintCardProps {
  blueprint: Blueprint;
  canApprove: boolean;
  isApproving?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

export const BlueprintCard = memo(({ blueprint, canApprove, isApproving = false, onApprove, onReject }: BlueprintCardProps) => {
  const [expanded, setExpanded] = useState(true);
  const panelId = useId();

  return (
    <section className={styles.Blueprint} aria-label="Game blueprint">
      <button className={styles.BlueprintHeader} type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((value) => !value)}>
        <span className="i-ph:blueprint text-xl text-violet-300 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className={styles.ActivityTitle}>{blueprint.title}</span><span className={styles.ActivitySubtitle}>Manager plan · {canApprove ? 'Waiting for your approval' : 'Reviewed blueprint'}</span></span>
        <span className={expanded ? 'i-ph:caret-up' : 'i-ph:caret-down'} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!expanded}>
        <div className={styles.BlueprintBody}>
          <p>{blueprint.summary}</p>
          <div className={styles.BlueprintMetrics}>
            <span><span className="i-ph:files" aria-hidden="true" />{blueprint.fileOperations.length} file changes</span>
            <span><span className="i-ph:image" aria-hidden="true" />{blueprint.assetOperations.length} new images</span>
            <span><span className="i-ph:shield-check" aria-hidden="true" />4 runtime scenarios</span>
          </div>
          <h4>Game systems</h4>
          <ul>{blueprint.systems.map((system) => <li key={system}>{system}</li>)}</ul>
          <h4>Files to change</h4>
          <div className={styles.PlannedFiles}>
            {blueprint.fileOperations.map((file) => <div key={file.path}><span className="i-ph:file-code text-slate-400" aria-hidden="true" /><code>{file.path}</code><span className={styles.Badge}>{file.operation === 'create' ? 'New' : 'Edit'}</span><p>{file.purpose}</p></div>)}
          </div>
          {blueprint.assetOperations.length > 0 ? <>
            <h4>Image Builder requests</h4>
            <div className={styles.PlannedFiles}>{blueprint.assetOperations.map((asset) => <div key={asset.id}><span className="i-ph:image text-violet-300" aria-hidden="true" /><code>{asset.path}</code><span className={styles.Badge}>{asset.width}×{asset.height}</span><p>{asset.prompt}</p></div>)}</div>
          </> : <p className={styles.PlanNote}>Uses existing assets and procedural visuals. No image-generation call is authorized.</p>}
          <h4>Acceptance checks</h4>
          <ul>{blueprint.acceptanceCriteria.map((check) => <li key={check}>{check}</li>)}</ul>
          <p className={styles.PlanNote}>Code and images stay blocked until approval. Changes are limited to these paths. Failed candidates are not marked verified.</p>
        </div>
      </div>
      {canApprove && <div className={styles.ApprovalActions}>
        <button type="button" disabled={isApproving} onClick={onApprove}><span className={isApproving ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:play-fill'} aria-hidden="true" />{isApproving ? 'Preparing build…' : 'Approve & Build'}</button>
        <button type="button" disabled={isApproving} onClick={onReject}>Cancel plan</button>
      </div>}
    </section>
  );
});
