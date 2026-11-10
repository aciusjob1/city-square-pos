import { useEffect, useState } from 'react';
import {
  getSettings,
  patchSettings,
  listPrintersFull,
  updatePrinter,
  deactivatePrinter,
} from '../../lib/manager.api';
import type { SettingsShape, PrinterRow } from '../../lib/manager.api';
import './ManagerSettings.css';

export function ManagerSettings() {
  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [printers, setPrinters] = useState<PrinterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [restaurantName, setRestaurantName] = useState('');
  const [currency, setCurrency] = useState('TZS');

  async function load() {
    const [sRes, pRes] = await Promise.all([getSettings(), listPrintersFull()]);
    if (!sRes.ok || !sRes.data) {
      setError(sRes.errorMessage ?? 'Failed to load settings');
      return;
    }
    if (pRes.ok && pRes.data) setPrinters(pRes.data.printers);
    setError(null);
    setSettings(sRes.data.settings);
    setRestaurantName(sRes.data.settings.restaurantName);
    setCurrency(sRes.data.settings.currency);
  }

  useEffect(() => { load(); }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  async function saveRestaurant() {
    setSaving(true);
    setError(null);
    const res = await patchSettings({
      restaurant_name: restaurantName.trim(),
      currency: currency.trim(),
    });
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Save failed'); return; }
    flash('Restaurant settings saved');
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
    const newIp = prompt(`New IP for "${p.name}":`, p.ipAddress);
    if (!newIp || newIp === p.ipAddress) return;
    const res = await updatePrinter(p.id, { ipAddress: newIp });
    if (!res.ok) { setError(res.errorMessage ?? 'Update failed'); return; }
    flash('Printer IP updated');
    await load();
  }

  async function handleDeactivate(p: PrinterRow) {
    if (!confirm(`Deactivate "${p.name}"?`)) return;
    const res = await deactivatePrinter(p.id);
    if (!res.ok) { setError(res.errorMessage ?? 'Deactivate failed'); return; }
    flash('Printer deactivated');
    await load();
  }

  const stationPrinters = (station: 'KITCHEN' | 'BAR' | 'NONE') =>
    printers.filter((p) => p.station === station && p.isActive);

  if (!settings && !error) {
    return <div className="page manager-page"><p className="muted">Loading…</p></div>;
  }

  return (
    <div className="page manager-page">
      <div className="manager-settings-header">
        <h2>Settings</h2>
      </div>

      {error && <div className="error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      <section className="manager-section">
        <h2>Restaurant</h2>
        <div className="manager-settings-form">
          <label>Restaurant name
            <input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} maxLength={100} />
          </label>
          <label>Currency
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} style={{ width: '100px' }} />
          </label>
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
        <h2>Printer Defaults</h2>
        <div className="manager-settings-form">
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

      <section className="manager-section">
        <h2>Printers</h2>
        <div className="manager-table-scroll">
          <table className="manager-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>IP</th>
                <th>Port</th>
                <th>Station</th>
                <th>Status</th>
                <th style={{ width: '200px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {printers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.ipAddress}</td>
                  <td>{p.port}</td>
                  <td>{p.station}</td>
                  <td>
                    <span className={`manager-user-pill ${p.isActive ? 'active' : 'inactive'}`}>
                      {p.isActive ? '● Active' : '● Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="manager-row-actions">
                      {p.isActive && <button onClick={() => editPrinterIp(p)}>Edit IP</button>}
                      {p.isActive && <button className="danger" onClick={() => handleDeactivate(p)}>Deactivate</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
