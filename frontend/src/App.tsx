import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, homePathForRole } from './auth/AuthContext';
import { loginPathForTerminal, rememberTerminalFromPath } from './lib/terminal';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Nav } from './components/Nav';
import { BrandingProvider } from './branding/BrandingContext';
import { LoginPage } from './pages/LoginPage';
import { WaiterLoginPage } from './pages/WaiterLoginPage';
import { AboutPage } from './pages/AboutPage';
import { WaiterHome } from './pages/waiter/WaiterHome';
import { OrderPage } from './pages/waiter/OrderPage';
import { MyOrdersPage } from './pages/waiter/MyOrdersPage';
import { PrintJobsPage } from './pages/print-jobs/PrintJobsPage';
import { CashierHome } from './pages/cashier/CashierHome';
import { OrdersPage } from './pages/orders/OrdersPage';
import { ManagerHome } from './pages/manager/ManagerHome';
import { ManagerLayout } from './pages/manager/ManagerLayout';
import { ManagerCategories } from './pages/manager/ManagerCategories';
import { ManagerProducts } from './pages/manager/ManagerProducts';
import { SoldOutPage } from './pages/sold-out/SoldOutPage';
import { ManagerStock } from './pages/manager/ManagerStock';
import { ManagerUsers } from './pages/manager/ManagerUsers';
import { ManagerSettings } from './pages/manager/ManagerSettings';
import { KitchenHome } from './pages/kitchen/KitchenHome';
import { SalesReports } from './pages/reports/SalesReports';
import { NotFound } from './pages/NotFound';

export default function App() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    rememberTerminalFromPath(location.pathname);
  }, [location.pathname]);

  return (
    <BrandingProvider>
      <Nav />
      <Routes>
        <Route path="/w/login" element={<WaiterLoginPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/about" element={<AboutPage />} />

        <Route
          path="/waiter"
          element={
            <ProtectedRoute allow={['WAITER']}>
              <WaiterHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/waiter/order/:tableId"
          element={
            <ProtectedRoute allow={['WAITER']}>
              <OrderPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/waiter/orders"
          element={
            <ProtectedRoute allow={['WAITER']}>
              <MyOrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/waiter/sales"
          element={
            <ProtectedRoute allow={['WAITER']}>
              <SalesReports mine />
            </ProtectedRoute>
          }
        />

        <Route
          path="/cashier"
          element={
            <ProtectedRoute allow={['CASHIER']}>
              <CashierHome />
            </ProtectedRoute>
          }
        />

        <Route
          path="/cashier/orders"
          element={
            <ProtectedRoute allow={['CASHIER']}>
              <OrdersPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/cashier/sold-out"
          element={
            <ProtectedRoute allow={['CASHIER']}>
              <SoldOutPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports"
          element={
            <ProtectedRoute allow={['CASHIER', 'MANAGER', 'ADMIN']}>
              <SalesReports />
            </ProtectedRoute>
          }
        />

        <Route
          path="/manager"
          element={
            <ProtectedRoute allow={['MANAGER', 'ADMIN']}>
              <ManagerLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<ManagerHome />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="reports" element={<SalesReports />} />
          <Route path="users" element={<ManagerUsers />} />
          <Route path="categories" element={<ManagerCategories />} />
          <Route path="products" element={<ManagerProducts />} />
          <Route path="sold-out" element={<SoldOutPage />} />
          <Route path="stock" element={<ManagerStock />} />
          <Route path="print-jobs" element={<PrintJobsPage />} />
          <Route path="settings" element={<ManagerSettings />} />
        </Route>

        <Route
          path="/kitchen"
          element={
            <ProtectedRoute allow={['KITCHEN']}>
              <KitchenHome />
            </ProtectedRoute>
          }
        />

        <Route
          path="/print-jobs"
          element={
            <ProtectedRoute allow={['WAITER', 'CASHIER', 'MANAGER', 'ADMIN']}>
              <PrintJobsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/"
          element={
            user ? <Navigate to={homePathForRole(user.role)} replace />
                 : <Navigate to={loginPathForTerminal()} replace />
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrandingProvider>
  );
}
