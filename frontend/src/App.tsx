import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, homePathForRole } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Nav } from './components/Nav';
import { LoginPage } from './pages/LoginPage';
import { WaiterLoginPage } from './pages/WaiterLoginPage';
import { WaiterHome } from './pages/waiter/WaiterHome';
import { OrderPage } from './pages/waiter/OrderPage';
import { MyOrdersPage } from './pages/waiter/MyOrdersPage';
import { PrintJobsPage } from './pages/print-jobs/PrintJobsPage';
import { CashierHome } from './pages/cashier/CashierHome';
import { ManagerHome } from './pages/manager/ManagerHome';
import { ManagerLayout } from './pages/manager/ManagerLayout';
import { ManagerPlaceholder } from './pages/manager/ManagerPlaceholder';
import { ManagerCategories } from './pages/manager/ManagerCategories';
import { ManagerProducts } from './pages/manager/ManagerProducts';
import { ManagerUsers } from './pages/manager/ManagerUsers';
import { KitchenHome } from './pages/kitchen/KitchenHome';
import { NotFound } from './pages/NotFound';

export default function App() {
  const { user } = useAuth();

  return (
    <>
      <Nav />
      <Routes>
        <Route path="/w/login" element={<WaiterLoginPage />} />
        <Route path="/login" element={<LoginPage />} />

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
          path="/cashier"
          element={
            <ProtectedRoute allow={['CASHIER']}>
              <CashierHome />
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
          <Route path="users" element={<ManagerUsers />} />
          <Route path="categories" element={<ManagerCategories />} />
          <Route path="products" element={<ManagerProducts />} />
          <Route path="settings" element={<ManagerPlaceholder />} />
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
                 : <Navigate to="/login" replace />
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
