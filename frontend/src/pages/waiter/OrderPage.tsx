import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  listCategories, listProducts, getActiveOrderForTable, getOrder,
  createOrder, appendItems, uuid,
} from '../../lib/waiter.api';
import type { CategoryRow, ProductRow, FullOrder } from '../../lib/waiter.api';

type CartLine = { productId: string; quantity: number };

export function OrderPage() {
  const { tableId: routeParam } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const isTakeaway = routeParam === 'takeaway';
  const tableId = isTakeaway ? null : routeParam;

  // Catalog
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Existing order (if table is active)
  const [activeOrder, setActiveOrder] = useState<FullOrder | null>(null);

  // Cart (unsent items only)
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const activeCategory = categories[0]?.id;
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // ---- Load catalog + existing order ----
  useEffect(() => {
    if (!tableId && !isTakeaway) return;
    let cancelled = false;

    (async () => {
      const [catsRes, prodsRes] = await Promise.all([listCategories(), listProducts()]);
      if (cancelled) return;
      if (!catsRes.ok || !prodsRes.ok) {
        setCatalogError('Failed to load catalog');
        return;
      }
      setCategories(catsRes.data?.categories ?? []);
      setProducts(prodsRes.data?.products ?? []);
      setSelectedCategoryId(catsRes.data?.categories?.[0]?.id ?? null);

      if (isTakeaway) return; // no existing order to resume
      const activeRes = await getActiveOrderForTable(tableId);
      if (cancelled) return;
      if (activeRes.ok && activeRes.data?.activeOrderId) {
        const orderRes = await getOrder(activeRes.data.activeOrderId);
        if (!cancelled && orderRes.ok && orderRes.data) {
          setActiveOrder(orderRes.data);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [tableId, isTakeaway]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const productsForCategory = useMemo(
    () => products.filter((p) => !selectedCategoryId || p.categoryId === selectedCategoryId),
    [products, selectedCategoryId],
  );

  const cartLines: Array<{ product: ProductRow; qty: number }> = useMemo(() => {
    const out: Array<{ product: ProductRow; qty: number }> = [];
    for (const [pid, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const p = products.find((x) => x.id === pid);
      if (p) out.push({ product: p, qty });
    }
    return out;
  }, [cart, products]);

  const cartItemCount = cartLines.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cartLines.reduce(
    (s, l) => s + parseFloat(l.product.sellingPrice) * l.qty,
    0,
  );

  const tableLabel = activeOrder?.table?.name ?? 'Table';

  const setQty = (productId: string, next: number) => {
    setCart((c) => {
      const copy = { ...c };
      if (next <= 0) delete copy[productId];
      else copy[productId] = next;
      return copy;
    });
  };

  const onSend = async () => {
    if (!tableId || cartLines.length === 0 || sending) return;
    setSending(true);
    setToast(null);

    const payloadItems = cartLines.map((l) => ({
      productId: l.product.id,
      quantity: l.qty,
    }));

    // Takeaway: always a new order, no table. Table order: append if active, else create.
    let res;
    if (activeOrder && !isTakeaway) {
      res = await appendItems(activeOrder.id, { clientUuid: uuid(), items: payloadItems });
    } else if (isTakeaway) {
      res = await createOrder({
        clientUuid: uuid(),
        orderType: 'TAKEAWAY',
        items: payloadItems,
      });
    } else {
      res = await createOrder({
        clientUuid: uuid(),
        tableId: tableId!,
        orderType: 'DINE_IN',
        items: payloadItems,
      });
    }

    setSending(false);
    if (!res.ok || !res.data) {
      setToast({ kind: 'err', text: res.errorMessage ?? 'Send failed' });
      return;
    }
    setActiveOrder(res.data);
    setCart({});
    setCartOpen(false);
    setToast({ kind: 'ok', text: 'Sent to kitchen' });
  };

  const sentItems = activeOrder?.items ?? [];

  return (
    <>
      <div className="order-header">
        <button className="back" onClick={() => navigate('/waiter')}>←</button>
        <div className="title">{isTakeaway ? 'Takeaway' : tableLabel} · Taking order</div>
      </div>

      <div className="page" style={{ paddingTop: 0 }}>
        {catalogError && <div className="error">{catalogError}</div>}

        {sentItems.length > 0 && (
          <div className="sent-section">
            <h3>Already sent to kitchen</h3>
            {sentItems.map((it) => (
              <div className="sent-item" key={it.id}>
                <span>
                  <span className="qty">{it.quantity}×</span>
                  {it.productName}
                </span>
                <span className="muted">Sent</span>
              </div>
            ))}
          </div>
        )}

        {sentItems.length === 0 && activeOrder === null && (
          <p className="muted" style={{ marginTop: 16 }}>New order — add items below.</p>
        )}

        <div className="category-tabs">
          {categories.map((c) => (
            <button
              key={c.id}
              className={`category-tab${c.id === selectedCategoryId ? ' active' : ''}`}
              onClick={() => setSelectedCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="product-list">
          {productsForCategory.map((p) => {
            const qty = cart[p.id] ?? 0;
            const available = p.available ?? 0;
            const isManaged = p.stockManaged === true;
            const outOfStock = isManaged && available <= 0;
            const limitReached = isManaged && qty >= available;
            const canIncrement = !outOfStock && !limitReached;
            return (
              <div className="product-card" key={p.id}>
                <div className="info">
                  <span className="name">{p.name}</span>
                  <span className="price">TZS {parseInt(p.sellingPrice, 10).toLocaleString()}</span>
                </div>
                <div className="qty-controls">
                  <button
                    aria-label={`Decrease ${p.name}`}
                    onClick={() => setQty(p.id, qty - 1)}
                    disabled={qty === 0}
                  >−</button>
                  <span className="qty">{qty}</span>
                  <button
                    aria-label={`Increase ${p.name}`}
                    onClick={() => setQty(p.id, qty + 1)}
                    disabled={!canIncrement}
                  >+</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`cart-bar${cartItemCount === 0 ? ' empty' : ''}`}
        onClick={() => { if (cartItemCount > 0) setCartOpen(true); }}
      >
        <div className="summary">
          <span className="items-count">
            {cartItemCount === 0 ? 'Cart is empty' : `${cartItemCount} item${cartItemCount === 1 ? '' : 's'}`}
          </span>
          <span className="total">
            TZS {Math.round(cartTotal).toLocaleString()}
          </span>
        </div>
        <button
          className="send"
          disabled={cartItemCount === 0 || sending}
          onClick={(e) => { e.stopPropagation(); if (cartItemCount > 0) { setCartOpen(true); } }}
        >
          {sending ? 'Sending…' : 'Review'}
        </button>
      </div>

      {cartOpen && (
        <div className="cart-sheet-backdrop" onClick={() => setCartOpen(false)}>
          <div className="cart-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Review — {tableLabel}</h3>
            {cartLines.map((l) => (
              <div className="cart-sheet-item" key={l.product.id}>
                <span>{l.qty}× {l.product.name}</span>
                <span>TZS {Math.round(parseFloat(l.product.sellingPrice) * l.qty).toLocaleString()}</span>
              </div>
            ))}
            <button
              className="send"
              style={{
                width: '100%', marginTop: 16, padding: 14, borderRadius: 8,
                border: 0, background: 'var(--primary)', color: '#fff',
                fontWeight: 600, fontSize: '1rem',
              }}
              disabled={sending}
              onClick={onSend}
            >
              {sending ? 'Sending…' : 'Send to kitchen'}
            </button>
            <button className="close-btn" onClick={() => setCartOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {toast && <div className={`toast${toast.kind === 'err' ? ' error' : ''}`}>{toast.text}</div>}
    </>
  );
}
