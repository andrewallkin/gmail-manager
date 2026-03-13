import { NavLink, Outlet } from "react-router-dom";
import { Status, logout } from "../lib/api";

type LayoutProps = {
  status: Status;
  onLogout: () => void;
};

const tabs = [
  { to: "/", label: "Dashboard" },
  { to: "/labels", label: "Labels" },
  { to: "/rules", label: "Rules" },
  { to: "/cleanup", label: "Cleanup" },
  { to: "/ai", label: "AI" },
  { to: "/settings", label: "Settings" },
];

export function Layout({ status, onLogout }: LayoutProps) {
  const handleLogout = async () => {
    try {
      await logout();
      onLogout();
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <span className="text-lg font-bold text-gray-900">
            Gmail <span className="text-blue-500">Manager</span>
          </span>
          <div className="flex items-center gap-3">
            {status.profile_picture_url && (
              <img
                src={status.profile_picture_url}
                alt="Profile"
                className="h-8 w-8 rounded-full object-cover border border-gray-200"
              />
            )}
            {status.display_name && (
              <span className="hidden sm:block text-sm font-medium text-gray-700">
                {status.display_name}
              </span>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-1 -mb-px">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === "/"}
                className={({ isActive }) =>
                  `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
