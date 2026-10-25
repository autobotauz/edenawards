import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { AuthProvider } from './lib/auth';
import { CurrentSeasonProvider } from './lib/season';
import { Home } from './pages/Home';
import { Submit } from './pages/Submit';
import { Browse } from './pages/Browse';
import { Results } from './pages/Results';
import { LoginPage, NotFound, VideoPage } from './pages/Misc';
import { AdminLayout } from './pages/admin/common';
import { AdminOverview } from './pages/admin/Overview';
import { AdminSeasons, SeasonEditorPage } from './pages/admin/Seasons';
import { AdminModeration } from './pages/admin/Moderation';
import { AdminAudit, AdminUsers } from './pages/admin/Users';
import { PresentConsole, PresentScreen } from './pages/present/Present';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/present/:seasonId/screen" element={<PresentScreen />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="submit" element={<Submit />} />
        <Route path="vote" element={<Browse />} />
        <Route path="results" element={<Results />} />
        <Route path="results/:seasonId" element={<Results />} />
        <Route path="videos/:id" element={<VideoPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="present/:seasonId" element={<PresentConsole />} />
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="seasons" element={<AdminSeasons />} />
          <Route path="seasons/:id" element={<SeasonEditorPage />} />
          <Route path="moderation" element={<AdminModeration />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <CurrentSeasonProvider>{children}</CurrentSeasonProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Providers>
        <AppRoutes />
      </Providers>
    </BrowserRouter>
  );
}
