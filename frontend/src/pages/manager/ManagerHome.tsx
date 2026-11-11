import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { listOrdersForCashier, listPrintJobs, getDailyReport } from '../../lib/waiter.api';
import type { PrintJobFull } from '../../lib/waiter.api';
import './ManagerHome.css';
import '../../dashboard-upgrade.css';
