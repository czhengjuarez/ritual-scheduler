import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PlanPage } from "./pages/PlanPage";
import { CadencesPage } from "./pages/CadencesPage";
import { LibraryPage } from "./pages/LibraryPage";
import { AdminPage } from "./pages/AdminPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/plan" replace />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/cadences" element={<CadencesPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}
