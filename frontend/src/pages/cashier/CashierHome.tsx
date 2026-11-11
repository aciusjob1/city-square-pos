import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  listOrdersForCashier,
  requestBill,
  getOrder,
  mergeOrders,
  unmergeBillGroup,
  printConsolidatedBill,
  getBillGroup,
} from '../../lib/waiter.api';
import type { FullOrder, BillGroupDetail } from '../../lib/waiter.api';
import './CashierHome.css';
import '../../dashboard-upgrade.css';
