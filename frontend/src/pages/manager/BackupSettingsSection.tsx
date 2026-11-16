import { useEffect, useMemo, useState } from 'react';
import { PageSearch } from '../../components/PageSearch';
import {
  createBackup,
  deleteBackup,
  discoverBackupFolders,
  getBackups,
  patchBackupSettings,
  searchBackups,
  testBackupFolder,
} from '../../lib/manager.api';
import type {
  BackupItemRow,
  BackupRunInfo,
  BackupsOverview,
  CloudFolderRow,
} from '../../lib/manager.api';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFree(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 10 ? `${Math.round(gb)} GB free` : `${gb.toFixed(1)} GB free`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function runStatus(run: BackupRunInfo | null): string {
  if (!run) return 'Never';
  const status = run.ok ? 'success' : 'failed';
  return `${formatDate(run.at)} — ${status}${run.name ? ` (${run.name})` : ''}`;
}

export function BackupSettingsSection() {
  const [overview, setOverview] = useState<BackupsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BackupItemRow[] | null>(null);
  const [searchScanned, setSearchScanned] = useState<number | null>(null);

  const [folders, setFolders] = useState<CloudFolderRow[] | null>(null);
  const [folderQuery, setFolderQuery] = useState('');
  const [folderStatus, setFolderStatus] = useState<string | null>(null);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoTime, setAutoTime] = useState('21:00');
  const [retention, setRetention] = useState('14');
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudPath, setCloudPath] = useState('');
  const [cloudCopy, setCloudCopy] = useState(false);

  async function load() {
    const res = await getBackups();
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Could not load backups');
      return;
    }
    const data = res.data;
    setOverview(data);
    setAutoEnabled(data.settings.autoEnabled);
    setAutoTime(data.settings.autoTime);
    setRetention(String(data.settings.retention));
    setCloudEnabled(data.settings.cloudEnabled);
    setCloudPath(data.settings.cloudPath ?? '');
    setCloudCopy(Boolean(data.settings.cloudPath && data.settings.cloudEnabled));
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredBackups = useMemo(() => {
    const items = overview?.backups ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.location.includes(q) ||
        item.folder.toLowerCase().includes(q),
    );
  }, [overview, query]);

  const visibleFolders = useMemo(() => {
    const list = folders ?? [];
    const q = folderQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (folder) =>
        folder.label.toLowerCase().includes(q) || folder.path.toLowerCase().includes(q),
    );
  }, [folders, folderQuery]);

  function flash(message: string) {
    setNotice(message);
    setError(null);
  }

  async function backupNow() {
    setBusy('backup');
    setError(null);
    setNotice(null);
    const res = await createBackup(cloudCopy);
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Backup failed');
      return;
    }
    if (res.data.errors.length > 0) {
      setError('Backup saved locally, but: ' + res.data.errors.join('; '));
    } else {
      flash(`Backup created: ${res.data.lastRun.name ?? ''}`);
    }
    await load();
  }

  async function saveSettings() {
    const keep = parseInt(retention, 10);
    if (!Number.isInteger(keep) || keep < 1 || keep > 365) {
      setError('Retention must be between 1 and 365 backups');
      return;
    }
    if (cloudEnabled && !cloudPath.trim()) {
      setError('Choose a cloud folder, or turn off cloud backup');
      return;
    }
    setBusy('save');
    setError(null);
    const res = await patchBackupSettings({
      autoEnabled,
      autoTime,
      retention: keep,
      cloudEnabled,
      cloudPath: cloudPath.trim() ? cloudPath.trim() : null,
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.errorMessage ?? 'Could not save backup settings');
      return;
    }
    flash('Backup settings saved');
    await load();
  }

  async function findFolders() {
    setBusy('folders');
    setError(null);
    setFolderStatus(null);
    const res = await discoverBackupFolders();
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Could not search for cloud folders');
      return;
    }
    setFolders(res.data.folders);
    if (res.data.folders.length === 0) {
      setFolderStatus('No OneDrive or cloud storage folder was found. Type the folder path instead.');
    } else {
      setFolderStatus(`Found ${res.data.folders.length} folder(s). Pick one, then save.`);
    }
  }

  async function testFolder() {
    if (!cloudPath.trim()) {
      setError('Type or choose a cloud folder first');
      return;
    }
    setBusy('test');
    setError(null);
    const res = await testBackupFolder(cloudPath.trim());
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Could not test the folder');
      return;
    }
    if (res.data.ok) {
      setFolderStatus(
        `Folder is writable${res.data.freeBytes ? ` — ${formatFree(res.data.freeBytes)}` : ''}.`,
      );
    } else {
      setError(`Folder is not writable: ${res.data.error ?? 'unknown error'}`);
    }
  }

  function useFolder(folder: CloudFolderRow) {
    setCloudPath(folder.path);
    setCloudEnabled(true);
    setFolderStatus(`Selected "${folder.label}". Save backup settings to apply.`);
  }

  async function searchOnPc() {
    setBusy('search');
    setError(null);
    const res = await searchBackups(query.trim());
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Backup search failed');
      return;
    }
    setSearchResults(res.data.backups);
    setSearchScanned(res.data.scannedFolders);
    setNotice(null);
  }

  async function remove(item: BackupItemRow) {
    if (item.location === 'found') return;
    if (!confirm(`Delete ${item.name} from ${item.location} backups?`)) return;
    setBusy('delete');
    const res = await deleteBackup(item.location, item.name);
    setBusy(null);
    if (!res.ok) {
      setError(res.errorMessage ?? 'Could not delete backup');
      return;
    }
    flash('Backup deleted');
    setSearchResults((current) =>
      current ? current.filter((entry) => entry.folder !== item.folder || entry.name !== item.name) : current,
    );
    await load();
  }

  const rows = searchResults ?? filteredBackups;

  return (
    <section className="manager-section manager-settings-wide backup-section">
      <h2>Data &amp; Backups</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        Back up the database to this computer and, optionally, to a OneDrive or
        other cloud folder. Automatic backups run while the app is open and
        catch up at the next start if a scheduled time was missed.
      </p>

      {error && <div className="error">{error}</div>}
      {notice && <div className="toast backup-toast">{notice}</div>}
      {overview && !overview.pgDumpAvailable && (
        <div className="error">
          pg_dump was not found. Reinstall City Square POS to restore the backup tool.
        </div>
      )}

      <div className="backup-summary">
        <div>
          <span className="backup-label">Local backup folder</span>
          <code>{overview?.localDir ?? 'Loading…'}</code>
        </div>
        <div>
          <span className="backup-label">Cloud backup folder</span>
          <code>{overview?.cloudDir ?? 'Not set'}</code>
        </div>
        <div>
          <span className="backup-label">Last manual backup</span>
          <span className={overview?.lastRun ? (overview.lastRun.ok ? 'backup-status-ok' : 'backup-status-fail') : 'muted'}>
            {runStatus(overview?.lastRun ?? null)}
          </span>
        </div>
        <div>
          <span className="backup-label">Last automatic backup</span>
          <span className={overview?.lastAuto ? (overview.lastAuto.ok ? 'backup-status-ok' : 'backup-status-fail') : 'muted'}>
            {runStatus(overview?.lastAuto ?? null)}
          </span>
        </div>
      </div>

      <div className="manager-settings-form backup-now-form">
        <label className="manager-radio">
          <input
            type="checkbox"
            checked={cloudCopy}
            disabled={!overview?.cloudDir || busy !== null}
            onChange={(e) => setCloudCopy(e.target.checked)}
          />
          Also copy to cloud
        </label>
        <div className="actions">
          <button
            className="primary"
            onClick={backupNow}
            disabled={busy !== null || !overview?.pgDumpAvailable}
          >
            {busy === 'backup' ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </div>

      <h3 className="backup-subhead">Automatic backups</h3>
      <div className="manager-settings-form">
        <label className="manager-radio">
          <input
            type="checkbox"
            checked={autoEnabled}
            onChange={(e) => setAutoEnabled(e.target.checked)}
          />
          Run automatically
        </label>
        <label>Time of day
          <input
            type="time"
            value={autoTime}
            onChange={(e) => setAutoTime(e.target.value)}
            style={{ width: '130px' }}
          />
        </label>
        <label>Keep latest
          <input
            type="number"
            min={1}
            max={365}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            style={{ width: '110px' }}
          />
        </label>
        <div className="actions">
          <button className="primary" onClick={saveSettings} disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Older backups beyond the retention count are deleted automatically in
        both the local and cloud folders.
      </p>

      <h3 className="backup-subhead">Cloud storage</h3>
      <div className="manager-settings-form">
        <label className="backup-path-field">Cloud backup folder
          <input
            value={cloudPath}
            onChange={(e) => setCloudPath(e.target.value)}
            placeholder="C:\Users\you\OneDrive\City Square Backups"
            spellCheck={false}
          />
        </label>
        <label className="manager-radio">
          <input
            type="checkbox"
            checked={cloudEnabled}
            onChange={(e) => setCloudEnabled(e.target.checked)}
          />
          Use cloud folder
        </label>
        <div className="actions">
          <button onClick={findFolders} disabled={busy !== null}>
            {busy === 'folders' ? 'Searching…' : 'Find OneDrive folders'}
          </button>
          <button onClick={testFolder} disabled={busy !== null}>
            {busy === 'test' ? 'Testing…' : 'Test folder'}
          </button>
        </div>
      </div>
      {folderStatus && <p className="backup-hint">{folderStatus}</p>}

      {folders && (
        <div className="backup-folders">
          <PageSearch
            value={folderQuery}
            onChange={setFolderQuery}
            placeholder="Search the folders found on this computer…"
            count={`${visibleFolders.length} of ${folders.length}`}
          />
          {visibleFolders.length === 0 && (
            <p className="muted">No folder matches your search.</p>
          )}
          <div className="backup-folder-list">
            {visibleFolders.map((folder) => (
              <div className="backup-folder" key={folder.path}>
                <div>
                  <strong>{folder.label}</strong>
                  <code>{folder.path}</code>
                </div>
                <span className="backup-free">{formatFree(folder.freeBytes)}</span>
                <button type="button" onClick={() => useFolder(folder)}>Use</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="backup-subhead">Stored backups</h3>
      <div className="backup-list-tools">
        <PageSearch
          value={query}
          onChange={(value) => {
            setQuery(value);
            setSearchResults(null);
          }}
          placeholder="Search backups by name, date, location or folder…"
          count={`${filteredBackups.length} shown`}
        />
        <button onClick={searchOnPc} disabled={busy !== null}>
          {busy === 'search' ? 'Searching…' : 'Search this PC'}
        </button>
        <button onClick={() => { setQuery(''); setSearchResults(null); void load(); }} disabled={busy !== null}>
          Refresh
        </button>
      </div>
      {searchResults !== null && (
        <p className="backup-hint">
          Found {searchResults.length} backup(s) in {searchScanned ?? 0} folders
          {query.trim() ? ` matching “${query.trim()}”` : ''}.{' '}
          <button type="button" className="linklike" onClick={() => setSearchResults(null)}>
            Clear search results
          </button>
        </p>
      )}

      <div className="manager-table-scroll">
        <table className="manager-table backup-table">
          <thead>
            <tr>
              <th>Backup file</th>
              <th>Created</th>
              <th>Size</th>
              <th>Location</th>
              <th>Folder</th>
              <th style={{ width: '110px' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center' }}>
                  {overview ? 'No backups yet. Use “Back up now” to create one.' : 'Loading backups…'}
                </td>
              </tr>
            )}
            {rows.map((item) => (
              <tr key={`${item.location}-${item.folder}-${item.name}`}>
                <td>{item.name}</td>
                <td>{formatDate(item.createdAt)}</td>
                <td>{formatBytes(item.sizeBytes)}</td>
                <td>
                  <span className={`backup-pill backup-pill-${item.location}`}>
                    {item.location === 'local' ? 'Local' : item.location === 'cloud' ? 'Cloud' : 'Found'}
                  </span>
                </td>
                <td className="backup-folder-cell">{item.folder}</td>
                <td>
                  {item.location === 'found' ? (
                    <span className="muted">—</span>
                  ) : (
                    <div className="manager-row-actions">
                      <button
                        className="danger"
                        onClick={() => remove(item)}
                        disabled={busy !== null}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
