import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, homePathForRole } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Nav } from './components/Nav';
import { LoginPage } from './pages/LoginPage';
import { WaiterHome } from './pages/waiter/WaiterHome';
import { CashierHome } from './pages/cashier/CashierHome';
import { ManagerHome } from './pages/manager/ManagerHome';
import { KitchenHome } from './pages/kitchen/KitchenHome';
import { NotFound } from './pages/NotFound';

export default function App() {
  const { user } = useAuth();

  return (
    <>
      <Nav />
      <Routes>
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
              <ManagerHome />
            </ProtectedRoute>
          }
        />

        <Route
          path="/kitchen"
          element={
            <ProtectedRoute allow={['KITCHEN']}>
              <KitchenHome />
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
