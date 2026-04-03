import { create } from 'zustand';
import type { AppTab } from '@components/HeaderBar';
import { NAV_TABS } from '@components/HeaderBar';

const TAB_STORAGE_KEY = 'santorini:lastTab';

const TAB_ALIASES: Record<string, AppTab> = {
  analyze: 'analysis',
};

const TAB_ORDER: AppTab[] = NAV_TABS.map((tab) => tab.key);

function normalizeTabKey(value: string | null): AppTab | null {
  if (!value) return null;
  return TAB_ALIASES[value] || (value as AppTab);
}

function resolveInitialTab(): AppTab {
  if (typeof window === 'undefined') return 'lobby';

  const { hash } = window.location;
  const defaultTab: AppTab = 'lobby';

  const hashTab = normalizeTabKey(hash.slice(1));
  if (hashTab && TAB_ORDER.includes(hashTab)) {
    return hashTab;
  }

  try {
    const storedTab = normalizeTabKey(window.localStorage.getItem(TAB_STORAGE_KEY));
    if (storedTab && TAB_ORDER.includes(storedTab)) {
      return storedTab;
    }
  } catch {
    // Ignore storage errors
  }

  return defaultTab;
}

function syncToUrl(tab: AppTab) {
  if (typeof window === 'undefined') return;
  try {
    const { pathname, search, hash } = window.location;
    const nextHash = `#${tab}`;
    if (hash !== nextHash) {
      window.history.replaceState(null, '', `${pathname}${search}${nextHash}`);
    }
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore errors
  }
}

interface NavigationState {
  activeTab: AppTab;
  pendingJobId: string | null;
  tabOrder: AppTab[];

  setActiveTab: (tab: AppTab) => void;
  navigateToAnalysis: (jobId?: string) => void;
  handleTabChange: (index: number) => void;
  setPendingJobId: (id: string | null) => void;
  getActiveIndex: () => number;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  activeTab: resolveInitialTab(),
  pendingJobId: null,
  tabOrder: TAB_ORDER,

  setActiveTab: (tab: AppTab) => {
    syncToUrl(tab);
    set({ activeTab: tab });
  },

  navigateToAnalysis: (jobId?: string) => {
    const updates: Partial<NavigationState> = { activeTab: 'analysis' };
    if (jobId) {
      updates.pendingJobId = jobId;
    }
    syncToUrl('analysis');
    set(updates);
  },

  handleTabChange: (index: number) => {
    const tab = TAB_ORDER[index];
    if (!tab) return;
    syncToUrl(tab);
    set({ activeTab: tab });
  },

  setPendingJobId: (id: string | null) => set({ pendingJobId: id }),

  getActiveIndex: () => {
    const { activeTab } = get();
    return Math.max(0, TAB_ORDER.indexOf(activeTab));
  },
}));

// Listen for browser back/forward navigation
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const hash = normalizeTabKey(window.location.hash.slice(1));
    if (hash && TAB_ORDER.includes(hash)) {
      useNavigationStore.setState({ activeTab: hash });
    }
  });
}
