import { apiFetch } from './api';

export type CategoryPrinterStation = 'KITCHEN' | 'BAR' | 'NONE';

export interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  printerStation?: CategoryPrinterStation | null;
  isActive?: boolean;
}

export async function listCategoriesFull() {
  return apiFetch<{ categories: CategoryRow[] }>('/categories');
}

export async function createCategory(input: {
  name: string;
  sortOrder?: number;
  printerStation?: CategoryPrinterStation | null;
}) {
  return apiFetch<CategoryRow>('/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateCategory(
  id: string,
  input: {
    name?: string;
    sortOrder?: number;
    printerStation?: CategoryPrinterStation | null;
  },
) {
  return apiFetch<CategoryRow>(`/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deactivateCategory(id: string) {
  return apiFetch<{ id: string; isActive: false }>(`/categories/${id}`, {
    method: 'DELETE',
  });
}

export interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string;
  categoryName?: string | null;
  sellingPrice: string;
  costPrice: string;
  preparationStation: 'KITCHEN' | 'BAR' | 'NONE';
  isActive?: boolean;
  reorderLevel?: number;
  stockManaged?: boolean;
  isAvailable?: boolean;
}

export async function listProductsFull() {
  return apiFetch<{ products: ProductRow[] }>('/products');
}

export async function createProduct(input: {
  name: string;
  sku?: string;
  categoryId: string;
  sellingPrice: number;
  costPrice?: number;
  preparationStation: 'KITCHEN' | 'BAR' | 'NONE';
}) {
  return apiFetch<ProductRow>('/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateProduct(id: string, input: {
  name?: string;
  sku?: string;
  categoryId?: string;
  sellingPrice?: number;
  costPrice?: number;
  preparationStation?: 'KITCHEN' | 'BAR' | 'NONE';
  reorderLevel?: number;
  stockManaged?: boolean;
  isAvailable?: boolean;
}) {
  return apiFetch<ProductRow>(`/products/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function setProductAvailability(id: string, isAvailable: boolean) {
  return apiFetch<ProductRow>(`/products/${id}/availability`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isAvailable }),
  });
}

export async function deactivateProduct(id: string) {
  return apiFetch<{ id: string; isActive: false }>(`/products/${id}`, {
    method: 'DELETE',
  });
}

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';
  isActive: boolean;
  lastLoginAt: string | null;
}

export async function listUsersFull() {
  return apiFetch<{ users: UserRow[] }>('/users');
}

export async function listRolesFull() {
  return apiFetch<{ roles: string[] }>('/roles');
}

export async function createUser(input: {
  username: string;
  fullName: string;
  email?: string;
  role: string;
  password?: string;
  pin?: string;
}) {
  return apiFetch<UserRow>('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateUser(id: string, input: {
  fullName?: string;
  email?: string;
  role?: string;
  password?: string;
  pin?: string;
}) {
  return apiFetch<UserRow>(`/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function resetUserPassword(id: string, newPassword: string) {
  return apiFetch<{ ok: true }>(`/users/${id}/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
}

export async function setUserPin(id: string, pin: string) {
  return apiFetch<{ ok: true }>(`/users/${id}/pin`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

export async function deactivateUser(id: string) {
  return apiFetch<{ id: string; isActive: false }>(`/users/${id}`, {
    method: 'DELETE',
  });
}

export async function activateUser(id: string) {
  return apiFetch<{ id: string; isActive: true }>(`/users/${id}/activate`, {
    method: 'PATCH',
  });
}

export interface SettingsShape {
  restaurantName: string;
  restaurantLogo: string | null;
  currency: string;
  timezone: string;
  printerDefaults: {
    kitchen: string | null;
    bar: string | null;
    receipt: string | null;
  };
  dayRolloverMode: 'AUTO' | 'MANUAL';
  networkAccess: 'ALL' | 'WIRED';
}

export interface NetworkAdapterInfo {
  name: string;
  address: string;
  netmask: string;
  network: string;
  kind: 'wired' | 'wireless' | 'virtual';
}

export interface NetworkInfo {
  adapters: NetworkAdapterInfo[];
  wiredSubnets: string[];
  warnings: string[];
}

export interface TlsCertificateSummary {
  subject: string;
  validFrom: string;
  validTo: string;
  thumbprint: string;
}

export interface TlsInfo {
  enabled: boolean;
  secure: boolean;
  port: number | null;
  redirectPort: number | null;
  certificateUrl: string | null;
  certificate: TlsCertificateSummary | null;
}

export async function getTlsInfo() {
  return apiFetch<TlsInfo>('/tls/info');
}

export type StationName = 'KITCHEN' | 'BAR' | 'NONE';

export interface PrinterRow {
  id: string;
  name: string;
  ipAddress: string | null;
  port: number;
  stations: StationName[];
  isActive: boolean;
  type: 'NETWORK' | 'OS';
}

export interface DiscoveredPrinter {
  name: string;
  driver: string | null;
  portName: string | null;
  status: string;
  isDefault: boolean;
}

export async function getSettings() {
  return apiFetch<{ settings: SettingsShape; network?: NetworkInfo }>('/settings');
}

export async function patchSettings(updates: Record<string, any>) {
  return apiFetch<{ ok: true }>('/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export interface TableConfig {
  tableCount: number;
  totalActiveTables: number;
}

export async function getTableConfig() {
  return apiFetch<TableConfig>('/tables/config');
}

export async function setTableCount(count: number) {
  return apiFetch<TableConfig>('/tables/count', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
}

export async function listPrintersFull() {
  return apiFetch<{ printers: PrinterRow[] }>('/printers');
}

export async function discoverPrinters() {
  return apiFetch<{ printers: DiscoveredPrinter[]; platform: string; warning?: string }>(
    '/printers/discover',
  );
}

export async function createPrinter(input: {
  name: string;
  type: 'NETWORK' | 'OS';
  stations: StationName[];
  ipAddress?: string;
  port?: number;
}) {
  return apiFetch<PrinterRow>('/printers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updatePrinter(id: string, input: {
  name?: string;
  ipAddress?: string;
  port?: number;
  stations?: StationName[];
  isActive?: boolean;
}) {
  return apiFetch<PrinterRow>(`/printers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function testPrinter(id: string) {
  return apiFetch<{ ok: true; printer: PrinterRow }>(`/printers/${id}/test`, {
    method: 'POST',
  });
}

export async function deactivatePrinter(id: string) {
  return apiFetch<{ id: string; isActive: false }>(`/printers/${id}`, {
    method: 'DELETE',
  });
}

export type StockStatus = 'OK' | 'LOW' | 'OUT' | 'UNTRACKED';

export interface StockBalanceRow {
  productId: string;
  productName: string;
  sku?: string | null;
  categoryName?: string | null;
  balance: number;
  reorderLevel: number;
  status: StockStatus;
  isAvailable: boolean;
}

export async function listStockBalances() {
  return apiFetch<{ balances: StockBalanceRow[] }>('/stock/balances');
}

export interface ProductStockState {
  productId: string;
  productName: string;
  isAvailable: boolean;
  stockManaged: boolean;
  balance: number | null;
  reorderLevel: number;
  status: StockStatus;
  platesLeft: number | null;
  limitedByPool: {
    id: string;
    name: string;
    unit: PoolUnit;
    available: number;
    platesLeft: number;
  } | null;
}

export async function listProductStockState() {
  return apiFetch<{ products: ProductStockState[] }>('/stock/availability');
}

export async function listLowStock() {
  return apiFetch<{ products: Array<{ productId: string; productName: string; balance: number; reorderLevel: number }> }>('/stock/low-stock');
}

export async function restockProduct(productId: string, quantity: number, notes?: string) {
  return apiFetch<{ ok: true }>('/stock/restock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, quantity, notes }),
  });
}

export type PoolUnit = 'G' | 'ML' | 'PIECES';

export interface StockPoolRow {
  id: string;
  name: string;
  unit: PoolUnit;
  reorderLevel: number;
  physical: number;
  reserved: number;
  available: number;
  status: StockStatus;
  productCount: number;
}

export interface PoolRecipeRow {
  productId: string;
  productName: string;
  sku?: string | null;
  categoryName?: string | null;
  quantityPerUnit: number;
}

export async function listStockPools() {
  return apiFetch<{ pools: StockPoolRow[] }>('/stock/pools');
}

export async function createStockPool(input: {
  name: string;
  unit: PoolUnit;
  reorderLevel?: number;
}) {
  return apiFetch<{ id: string; name: string; unit: PoolUnit; reorderLevel: number }>(
    '/stock/pools',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function updateStockPool(poolId: string, input: {
  name?: string;
  unit?: PoolUnit;
  reorderLevel?: number;
}) {
  return apiFetch<{ ok: true }>(`/stock/pools/${poolId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function restockPool(poolId: string, quantity: number, notes?: string) {
  return apiFetch<{ ok: true }>(`/stock/pools/${poolId}/restock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity, notes }),
  });
}

export async function listPoolRecipes(poolId: string) {
  return apiFetch<{
    pool: { id: string; name: string; unit: PoolUnit };
    recipes: PoolRecipeRow[];
  }>(`/stock/pools/${poolId}/recipes`);
}

export async function upsertPoolRecipe(
  poolId: string,
  productId: string,
  quantityPerUnit: number,
) {
  return apiFetch<{ ok: true }>(`/stock/pools/${poolId}/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, quantityPerUnit }),
  });
}

export async function removePoolRecipe(poolId: string, productId: string) {
  return apiFetch<{ ok: true }>(
    `/stock/pools/${poolId}/recipes/${encodeURIComponent(productId)}`,
    { method: 'DELETE' },
  );
}

export interface BackupSettingsShape {
  autoEnabled: boolean;
  autoTime: string;
  retention: number;
  cloudEnabled: boolean;
  cloudPath: string | null;
}

export interface BackupItemRow {
  name: string;
  location: 'local' | 'cloud' | 'found';
  folder: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupRunInfo {
  at: string;
  ok: boolean;
  name: string | null;
  errors: string[];
}

export interface BackupsOverview {
  settings: BackupSettingsShape;
  localDir: string;
  cloudDir: string | null;
  backups: BackupItemRow[];
  lastRun: BackupRunInfo | null;
  lastAuto: BackupRunInfo | null;
  pgDumpAvailable: boolean;
}

export interface CloudFolderRow {
  path: string;
  label: string;
  kind: 'onedrive' | 'cloud';
  freeBytes: number | null;
}

export async function getBackups(q?: string) {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : '';
  return apiFetch<BackupsOverview>(`/backups${suffix}`);
}

export async function createBackup(cloud: boolean) {
  return apiFetch<{
    ok: true;
    backups: BackupItemRow[];
    errors: string[];
    lastRun: BackupRunInfo;
  }>('/backups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cloud }),
    timeoutMs: 180_000,
  });
}

export async function patchBackupSettings(input: {
  autoEnabled?: boolean;
  autoTime?: string;
  retention?: number;
  cloudEnabled?: boolean;
  cloudPath?: string | null;
}) {
  return apiFetch<{ ok: true; settings: BackupSettingsShape }>('/backups/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function discoverBackupFolders() {
  return apiFetch<{
    home: string;
    roots: Array<{ path: string; label: string; kind: 'onedrive' | 'cloud' }>;
    folders: CloudFolderRow[];
  }>('/backups/folders');
}

export async function testBackupFolder(path: string) {
  return apiFetch<{
    ok: boolean;
    path: string;
    writable: boolean;
    freeBytes: number | null;
    error?: string;
  }>('/backups/folders/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export async function searchBackups(q: string) {
  return apiFetch<{ query: string; backups: BackupItemRow[]; scannedFolders: number }>(
    `/backups/search?q=${encodeURIComponent(q)}`,
  );
}

export async function deleteBackup(location: 'local' | 'cloud', name: string) {
  return apiFetch<{ ok: true }>(
    `/backups/${location}/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );
}

