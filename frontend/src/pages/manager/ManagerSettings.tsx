import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useBranding } from '../../branding/BrandingContext';
import { PageSearch } from '../../components/PageSearch';
import { ChangePasswordDialog } from '../../components/ChangePasswordDialog';
import {
  getSettings,
  patchSettings,
  listPrintersFull,
  updatePrinter,
  deactivatePrinter,
  testPrinter,
  discoverPrinters,
  createPrinter,
  getTableConfig,
  setTableCount,
  getTlsInfo,
} from '../../lib/manager.api';
import type {
  SettingsShape, PrinterRow, DiscoveredPrinter, StationName, NetworkInfo, TlsInfo,
} from '../../lib/manager.api';
import { BackupSettingsSection } from './BackupSettingsSection';
import './ManagerSettings.css';

const ALL_STATIONS: StationName[] = ['KITCHEN', 'BAR', 'NONE'];
const STATION_LABEL: Record<StationName, string> = {
  KITCHEN: 'Kitchen',
  BAR: 'Bar',
  NONE: 'Receipt',
};

function formatCertificateDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

export function ManagerSettings() {
  const { user } = useAuth();
  const { refreshBranding } = useBranding();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [printers, setPrinters] = useState<PrinterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantLogo, setRestaurantLogo] = useState<string | null>(null);
  const [logoDirty, setLogoDirty] = useState(false);
  const [currency, setCurrency] = useState('TZS');

  const [tableCountInput, setTableCountInput] = useState('10');
  const [activeTables, setActiveTables] = useState<number | null>(null);
  const [savingTables, setSavingTables] = useState(false);
  const [savingDayMode, setSavingDayMode] = useState(false);
  const [savingNetwork, setSavingNetwork] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [tlsInfo, setTlsInfo] = useState<TlsInfo | null>(null);

  const [discovered, setDiscovered] = useState<DiscoveredPrinter[] | null>(null);
  const [discoveryWarning, setDiscoveryWarning] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [addStations, setAddStations] = useState<Record<string, StationName[]>>({});
  const [stationDrafts, setStationDrafts] = useState<Record<string, StationName[]>>({});
  const [savingStationsFor, setSavingStationsFor] = useState<string | null>(null);
  const [addingPrinter, setAddingPrinter] = useState<string | null>(null);
  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);
  const [printerQuery, setPrinterQuery] = useState('');

  async function load() {
    const [sRes, pRes, tRes, tlsRes] = await Promise.all([
      getSettings(),
      listPrintersFull(),
      getTableConfig(),
      getTlsInfo(),
    ]);
    if (tlsRes.ok && tlsRes.data) setTlsInfo(tlsRes.data);
    if (!sRes.ok || !sRes.data) {
      setError(sRes.errorMessage ?? 'Failed to load settings');
      return;
    }
    if (pRes.ok && pRes.data) setPrinters(pRes.data.printers);
    setError(null);
    setSettings(sRes.data.settings);
    setNetworkInfo(sRes.data.network ?? null);
    setRestaurantName(sRes.data.settings.restaurantName);
    setRestaurantLogo(sRes.data.settings.restaurantLogo);
    setLogoDirty(false);
    setCurrency(sRes.data.settings.currency);
    if (tRes.ok && tRes.data) {
      setTableCountInput(String(tRes.data.tableCount));
      setActiveTables(tRes.data.totalActiveTables);
    }
  }

  useEffect(() => { load(); }, []);

  const flashTimer = useRef<number | null>(null);

  function flash(msg: string) {
    setToast(msg);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null;
      setToast(null);
    }, 2000);
  }

  async function saveRestaurant() {
    setSaving(true);
    setError(null);
    const payload: Record<string, any> = {
      restaurant_name: restaurantName.trim(),
      currency: currency.trim(),
    };
    if (logoDirty) payload.restaurant_logo = restaurantLogo;
    const res = await patchSettings(payload);
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Save failed'); return; }
    flash('Restaurant settings saved');
    await refreshBranding();
    await load();
  }

  function onLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Logo must be an image file');
      return;
    }
    if (file.size > 500 * 1024) {
      setError('Logo must be smaller than 500 KB');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setRestaurantLogo(String(reader.result));
      setLogoDirty(true);
    };
    reader.readAsDataURL(file);
  }

  async function saveTables() {
    const count = parseInt(tableCountInput, 10);
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      setError('Number of tables must be between 1 and 200');
      return;
    }
    setSavingTables(true);
    setError(null);
    const res = await setTableCount(count);
    setSavingTables(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Could not update tables'); return; }
    flash(`${count} tables are now active`);
    await load();
  }

  async function saveDayMode(mode: 'AUTO' | 'MANUAL') {
    setSavingDayMode(true);
    setError(null);
    const res = await patchSettings({ 'day.rollover_mode': mode });
    setSavingDayMode(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Could not update rollover mode'); return; }
    flash(mode === 'AUTO' ? 'Automatic rollover enabled' : 'Manual rollover enabled');
    await load();
  }

  async function saveNetworkAccess(mode: 'ALL' | 'WIRED') {
    setSavingNetwork(true);
    setError(null);
    const res = await patchSettings({ network_access: mode });
    setSavingNetwork(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Could not update network access'); return; }
    flash(mode === 'WIRED' ? 'Cable-only terminals enabled' : 'Wi-Fi terminals allowed');
    await load();
  }

  async function updateDefault(station: 'KITCHEN' | 'BAR' | 'NONE', printerId: string | null) {
    const key = {
      KITCHEN: 'printer.default.kitchen',
      BAR: 'printer.default.bar',
      NONE: 'printer.default.receipt',
    }[station];
    setSaving(true);
    setError(null);
    const res = await patchSettings({ [key]: printerId });
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Update failed'); return; }
    flash('Default updated');
    await load();
  }

  async function editPrinterIp(p: PrinterRow) {
    const newIp = prompt(`New IP for "${p.name}":`, p.ipAddress ?? '');
    if (!newIp || newIp === p.ipAddress) return;
    const res = await updatePrinter(p.id, { ipAddress: newIp });
    if (!res.ok) { setError(res.errorMessage ?? 'Update failed'); return; }
    flash('Printer IP updated');
    await load();
  }

  async function searchPrinters() {
    setDiscovering(true);
    setError(null);
    setDiscoveryWarning(null);
    const res = await discoverPrinters();
    setDiscovering(false);
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Printer search failed');
      return;
    }
    setDiscovered(res.data.printers);
    setDiscoveryWarning(res.data.warning ?? null);
    if (res.data.printers.length === 0 && !res.data.warning) {
      flash('No printers found on this computer');
    }
  }

  function toggleAddStation(name: string, station: StationName) {
    setAddStations((prev) => {
      const cur = prev[name] ?? ['NONE'];
      const next = cur.includes(station)
        ? cur.filter((s) => s !== station)
        : [...cur, station];
      return { ...prev, [name]: next };
    });
  }

  async function addDiscovered(d: DiscoveredPrinter) {
    const stations = addStations[d.name] ?? ['NONE'];
    if (stations.length === 0) {
      setError('Pick at least one station for this printer');
      return;
    }
    setAddingPrinter(d.name);
    setError(null);
    const res = await createPrinter({
      name: d.name,
      type: 'OS',
      stations,
    });
    setAddingPrinter(null);
    if (!res.ok) {
      setError(res.errorMessage ?? 'Could not add printer');
      return;
    }
    flash(`Added "${d.name}"`);
    await load();
  }

  function startEditStations(p: PrinterRow) {
    setError(null);
    setStationDrafts((prev) => ({ ...prev, [p.id]: [...p.stations] }));
  }

  function cancelEditStations(id: string) {
    setStationDrafts((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }

  function toggleDraftStation(id: string, station: StationName) {
    setStationDrafts((prev) => {
      const cur = prev[id] ?? [];
      const next = cur.includes(station)
        ? cur.filter((s) => s !== station)
        : [...cur, station];
      return { ...prev, [id]: next };
    });
  }

  async function saveStations(p: PrinterRow) {
    const stations = stationDrafts[p.id] ?? [];
    if (stations.length === 0) {
      setError('A printer needs at least one station');
      return;
    }
    setSavingStationsFor(p.id);
    setError(null);
    const res = await updatePrinter(p.id, { stations });
    setSavingStationsFor(null);
    if (!res.ok) { setError(res.errorMessage ?? 'Update failed'); return; }
    flash('Printer stations updated');
    cancelEditStations(p.id);
    await load();
  }

  async function handleTestPrint(p: PrinterRow) {
    setTestingPrinter(p.id);
    setError(null);
    const res = await testPrinter(p.id);
    setTestingPrinter(null);
    if (!res.ok) { setError(res.errorMessage ?? 'Test print failed'); return; }
    flash(`Test ticket sent to "${p.name}"`);
  }

  async function handleActivate(p: PrinterRow) {
    setSavingStationsFor(p.id);
    setError(null);
    const res = await updatePrinter(p.id, { isActive: true });
    setSavingStationsFor(null);
    if (!res.ok) { setError(res.errorMessage ?? 'Activate failed'); return; }
    flash(`"${p.name}" is active again`);
    await load();
  }

  async function handleDeactivate(p: PrinterRow) {
    if (!confirm(`Deactivate "${p.name}"?`)) return;
    const res = await deactivatePrinter(p.id);
    if (!res.ok) { setError(res.errorMessage ?? 'Deactivate failed'); return; }
    flash('Printer deactivated');
    await load();
  }

  const stationPrinters = (station: StationName) =>
    printers.filter((p) => p.stations.includes(station) && p.isActive);

  const isConfigured = (name: string) =>
    printers.some(
      (p) => p.type === 'OS' && p.name.toLowerCase() === name.toLowerCase(),
    );

  const filteredPrinters = useMemo(() => {
    const q = printerQuery.trim().toLowerCase();
    if (!q) return printers;
    return printers.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.type.toLowerCase().includes(q) ||
      (p.ipAddress ?? '').toLowerCase().includes(q) ||
      (p.isActive ? 'active' : 'inactive').includes(q) ||
      p.stations.some(
        (s) => s.toLowerCase().includes(q) || STATION_LABEL[s].toLowerCase().includes(q),
      ),
    );
  }, [printers, printerQuery]);

  if (!settings && !error) {
    return <div className="page manager-page manager-settings-page"><p className="muted">Loading…</p></div>;
  }

  return (
    <div className="page manager-page manager-settings-page">
      <div className="manager-page-header">
        <h2>Settings</h2>
      </div>

      {error && <div className="error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      <section className="manager-section manager-settings-wide">
        <h2>Restaurant</h2>
        <div className="manager-settings-form">
          <label>Restaurant name
            <input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} maxLength={100} />
          </label>
          <label>Currency
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} style={{ width: '100px' }} />
          </label>
          <div className="manager-logo-field">
            <span>Restaurant logo</span>
            <div className="manager-logo-preview">
              {restaurantLogo
                ? <img src={restaurantLogo} alt="Restaurant logo preview" />
                : <span className="muted">No logo uploaded</span>}
            </div>
            <div className="manager-logo-actions">
              <label className="manager-logo-upload">
                {restaurantLogo ? 'Change logo' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  onChange={onLogoFile}
                />
              </label>
              {restaurantLogo && (
                <button
                  type="button"
                  onClick={() => { setRestaurantLogo(null); setLogoDirty(true); }}
                >
                  Remove logo
                </button>
              )}
            </div>
            <p className="muted">
              PNG, JPEG, WebP, GIF or SVG up to 500 KB. Shown on the login
              screens and the top bar.
            </p>
          </div>
          <div className="actions">
            <button className="primary" onClick={saveRestaurant} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Timezone: <strong>{settings?.timezone}</strong> (read-only)
        </p>
      </section>

      <section className="manager-section">
        <h2>Tables</h2>
        <div className="manager-settings-form">
          <label>Number of tables
            <input
              type="number"
              min={1}
              max={200}
              value={tableCountInput}
              onChange={(e) => setTableCountInput(e.target.value)}
              style={{ width: '100px' }}
            />
          </label>
          <div className="actions">
            <button className="primary" onClick={saveTables} disabled={savingTables}>
              {savingTables ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Waiters see exactly this many tables.
          {activeTables !== null && ` Currently ${activeTables} active in the system.`}
          {' '}Lowering the count hides surplus tables; a table with an open
          order must be closed before it can be removed.
        </p>
      </section>

      <section className="manager-section">
        <h2>Network access</h2>
        <div className="manager-settings-form">
          <label className="manager-radio">
            <input
              type="radio"
              name="network-access"
              checked={settings?.networkAccess !== 'WIRED'}
              onChange={() => saveNetworkAccess('ALL')}
              disabled={savingNetwork}
            />
            Allow Wi-Fi and cable terminals
          </label>
          <label className="manager-radio">
            <input
              type="radio"
              name="network-access"
              checked={settings?.networkAccess === 'WIRED'}
              onChange={() => saveNetworkAccess('WIRED')}
              disabled={savingNetwork}
            />
            Cable (LAN) only — block Wi-Fi terminals
          </label>
        </div>

        {networkInfo && networkInfo.adapters.length > 0 ? (
          <ul className="manager-network-adapters">
            {networkInfo.adapters.map((a) => (
              <li key={a.name + ':' + a.address}>
                <strong>{a.name}</strong>
                <span>{a.address}</span>
                <span className={
                  a.kind === 'wired' ? 'network-kind wired'
                    : a.kind === 'wireless' ? 'network-kind wireless' : 'network-kind virtual'
                }>
                  {a.kind === 'wired' ? 'cable' : a.kind === 'wireless' ? 'Wi-Fi' : 'virtual'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>No network adapters detected.</p>
        )}

        {networkInfo && networkInfo.wiredSubnets.length > 0 && (
          <p className="muted" style={{ marginTop: 8 }}>
            Cable subnet(s) accepted in cable-only mode: <code>{networkInfo.wiredSubnets.join(', ')}</code>
          </p>
        )}

        {networkInfo?.warnings.map((w) => (
          <div key={w} className="manager-warning">{w}</div>
        ))}

        <p className="muted" style={{ marginTop: 8 }}>
          Cable-only mode accepts terminals whose address is on the same network as this
          PC's Ethernet adapter; Wi-Fi clients on a different subnet are refused. The server
          cannot see how a remote device is physically attached, so if your router bridges
          cable and Wi-Fi into one subnet, use a separate Wi-Fi network/VLAN for the strict
          lock. The server itself always stays reachable. Login and PIN attempts stay
          rate-limited on every connection type.
        </p>
      </section>

      <section className="manager-section">
        <h2>Connection security</h2>
        {tlsInfo ? (
          <>
            <div className={`manager-security-card ${tlsInfo.secure ? 'secure' : 'insecure'}`}>
              <span className="manager-security-dot" aria-hidden="true" />
              <div className="manager-security-copy">
                <strong>
                  {tlsInfo.secure
                    ? 'Encrypted with HTTPS'
                    : tlsInfo.enabled
                      ? 'HTTPS is configured but this page is not encrypted'
                      : 'Plain HTTP — traffic is not encrypted'}
                </strong>
                <span className="muted">
                  {tlsInfo.secure
                    ? `This browser is connected over HTTPS on port ${tlsInfo.port}.` +
                      (formatCertificateDate(tlsInfo.certificate?.validTo)
                        ? ` The certificate is valid until ${formatCertificateDate(tlsInfo.certificate?.validTo)}.`
                        : '')
                    : tlsInfo.enabled
                      ? `Open https://${window.location.hostname}:${tlsInfo.port} instead of the http:// address.`
                      : 'Run the current installer on the server PC to switch the app to HTTPS.'}
                </span>
              </div>
            </div>

            {tlsInfo.certificateUrl && (
              <div className="manager-security-actions">
                <a
                  className="manager-security-download"
                  href={tlsInfo.certificateUrl}
                  download="CitySquarePOS.cer"
                >
                  Download certificate
                </a>
                <p className="muted">
                  Install this file on every other device once: double-click it, choose
                  <strong> Install Certificate → Current User → Place all certificates in the following store →
                    Trusted Root Certification Authorities</strong>. The browser then shows the padlock
                  without a warning on every launch.
                </p>
              </div>
            )}

            {tlsInfo.redirectPort !== null && (
              <p className="muted" style={{ marginTop: 8 }}>
                Plain http:// addresses on port {tlsInfo.redirectPort} are redirected
                to the encrypted address automatically.
              </p>
            )}
          </>
        ) : (
          <p className="muted">Checking connection security…</p>
        )}
      </section>

      <section className="manager-section">
        <h2>Business day</h2>
        <div className="manager-settings-form">
          <label className="manager-radio">
            <input
              type="radio"
              name="day-rollover"
              checked={settings?.dayRolloverMode === 'MANUAL'}
              onChange={() => saveDayMode('MANUAL')}
              disabled={savingDayMode}
            />
            Manual rollover
          </label>
          <label className="manager-radio">
            <input
              type="radio"
              name="day-rollover"
              checked={settings?.dayRolloverMode === 'AUTO'}
              onChange={() => saveDayMode('AUTO')}
              disabled={savingDayMode}
            />
            Automatic rollover
          </label>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Manual: open and close the day yourself from the dashboard or the
          cashier home. Automatic: as soon as the first request arrives on a
          new business day, the previous day is closed and a new one opened.
        </p>
      </section>

      <section className="manager-section">
        <h2>My account</h2>
        <div className="manager-account-row">
          <span className="manager-account-avatar" aria-hidden="true">
            {user?.fullName?.trim().charAt(0).toUpperCase() ?? '?'}
          </span>
          <div className="manager-account-identity">
            <strong>{user?.fullName}</strong>
            <span className="muted">
              @{user?.username} ·{' '}
              {user?.role === 'ADMIN' ? 'Administrator' : 'Manager'}
            </span>
          </div>
          <button
            className="primary manager-account-action"
            type="button"
            onClick={() => setPasswordOpen(true)}
          >
            Change password
          </button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Your current password is required. Use at least 8 characters with a
          letter and a digit.
        </p>
      </section>

      <BackupSettingsSection />

      <section className="manager-section manager-settings-wide">
        <h2>Printer Defaults</h2>        <div className="manager-settings-form">
          <label>Kitchen printer
            <select
              value={settings?.printerDefaults.kitchen ?? ''}
              onChange={(e) => updateDefault('KITCHEN', e.target.value || null)}
            >
              <option value="">— First active KITCHEN printer —</option>
              {stationPrinters('KITCHEN').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>Bar printer
            <select
              value={settings?.printerDefaults.bar ?? ''}
              onChange={(e) => updateDefault('BAR', e.target.value || null)}
            >
              <option value="">— First active BAR printer —</option>
              {stationPrinters('BAR').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>Receipt printer
            <select
              value={settings?.printerDefaults.receipt ?? ''}
              onChange={(e) => updateDefault('NONE', e.target.value || null)}
            >
              <option value="">— First active NONE printer —</option>
              {stationPrinters('NONE').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="manager-section manager-settings-wide">
        <h2>Printers</h2>

        <div className="manager-settings-form">
          <div className="manager-settings-search">
            <span>Find printers</span>
            <button
              className="primary"
              onClick={searchPrinters}
              disabled={discovering}
            >
              {discovering ? 'Searching…' : 'Search this computer'}
            </button>
          </div>
          <p className="muted" style={{ margin: 0, flex: 1, minWidth: '220px' }}>
            Lists printers installed on the computer running the POS server.
            Add one to make it available here and in the printer defaults.
          </p>
        </div>

        {discoveryWarning && <div className="error">{discoveryWarning}</div>}

        {discovered && !discoveryWarning && discovered.length === 0 && (
          <p className="muted">No printers were found on this computer.</p>
        )}

        {discovered && discovered.length > 0 && (
          <div className="manager-table-scroll manager-printer-discovery" style={{ marginBottom: 16 }}>
            <table className="manager-table">
              <thead>
                <tr>
                  <th>Found printer</th>
                  <th>Driver</th>
                  <th>Port</th>
                  <th>Status</th>
                  <th>Stations</th>
                  <th style={{ width: '130px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {discovered.map((d) => {
                  const configured = isConfigured(d.name);
                  return (
                    <tr key={d.name}>
                      <td>
                        {d.name}
                        {d.isDefault && <span className="muted"> (default)</span>}
                      </td>
                      <td>{d.driver ?? '—'}</td>
                      <td>{d.portName ?? '—'}</td>
                      <td>{d.status}</td>
                      <td>
                        <div className="station-checks">
                          {ALL_STATIONS.map((station) => {
                            const checked = (addStations[d.name] ?? ['NONE']).includes(station);
                            return (
                              <label key={station} className="station-check">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleAddStation(d.name, station)}
                                  disabled={configured}
                                />
                                {STATION_LABEL[station]}
                              </label>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <button
                          className="primary"
                          onClick={() => addDiscovered(d)}
                          disabled={configured || addingPrinter !== null}
                        >
                          {configured ? 'Added' : addingPrinter === d.name ? 'Adding…' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <PageSearch
          value={printerQuery}
          onChange={setPrinterQuery}
          placeholder="Search printers by name, type, IP or station…"
          count={`${filteredPrinters.length} of ${printers.length}`}
        />

        <div className="manager-table-scroll">
          <table className="manager-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>IP</th>
                <th>Port</th>
                <th>Stations</th>
                <th>Status</th>
                <th style={{ width: '240px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPrinters.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center' }}>No printers match your search.</td>
                </tr>
              )}
              {filteredPrinters.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.type}</td>
                  <td>{p.ipAddress ?? '—'}</td>
                  <td>{p.port}</td>
                  <td>
                    {stationDrafts[p.id] ? (
                      <div className="station-checks">
                        {ALL_STATIONS.map((station) => (
                          <label key={station} className="station-check">
                            <input
                              type="checkbox"
                              checked={stationDrafts[p.id].includes(station)}
                              onChange={() => toggleDraftStation(p.id, station)}
                            />
                            {STATION_LABEL[station]}
                          </label>
                        ))}
                      </div>
                    ) : p.stations.length > 0 ? (
                      <div className="station-pills">
                        {p.stations.map((station) => (
                          <span className={`station-pill station-${station.toLowerCase()}`} key={station}>
                            {STATION_LABEL[station]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className={`manager-user-pill ${p.isActive ? 'active' : 'inactive'}`}>
                      {p.isActive ? '● Active' : '● Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="manager-row-actions">
                      {stationDrafts[p.id] ? (
                        <>
                          <button
                            className="primary"
                            onClick={() => saveStations(p)}
                            disabled={savingStationsFor === p.id}
                          >
                            {savingStationsFor === p.id ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => cancelEditStations(p.id)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          {p.isActive && p.type === 'NETWORK' && (
                            <button onClick={() => editPrinterIp(p)}>Edit IP</button>
                          )}
                          {p.isActive && (
                            <button
                              onClick={() => handleTestPrint(p)}
                              disabled={testingPrinter !== null}
                            >
                              {testingPrinter === p.id ? 'Printing…' : 'Test print'}
                            </button>
                          )}
                          {p.isActive && (
                            <button onClick={() => startEditStations(p)}>Stations</button>
                          )}
                          {p.isActive && <button className="danger" onClick={() => handleDeactivate(p)}>Deactivate</button>}
                          {!p.isActive && (
                            <button
                              className="primary"
                              onClick={() => handleActivate(p)}
                              disabled={savingStationsFor === p.id}
                            >
                              {savingStationsFor === p.id ? 'Activating…' : 'Activate'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {passwordOpen && (
        <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />
      )}
    </div>
  );
}
