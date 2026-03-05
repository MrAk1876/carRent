import React from 'react';
import { assets, ownerMenuLinks } from '../../../assets/assets';
import { useLocation, useNavigate } from 'react-router-dom';
import { getUser, hasPermission } from '../../../utils/auth';
import { normalizeRole } from '../../../utils/rbac';
import { resolveImageUrl } from '../../../utils/image';
import ThemeToggle from '../../../components/ThemeToggle';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import AddCircleRoundedIcon from '@mui/icons-material/AddCircleRounded';
import DirectionsCarRoundedIcon from '@mui/icons-material/DirectionsCarRounded';
import ViewTimelineRoundedIcon from '@mui/icons-material/ViewTimelineRounded';
import DriveEtaRoundedIcon from '@mui/icons-material/DriveEtaRounded';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded';
import RateReviewRoundedIcon from '@mui/icons-material/RateReviewRounded';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
import CardMembershipRoundedIcon from '@mui/icons-material/CardMembershipRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import PlaylistAddCheckRoundedIcon from '@mui/icons-material/PlaylistAddCheckRounded';
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import SidebarGroup from './SidebarGroup';
import SidebarSearch from './SidebarSearch';
import './Sidebar.css';

const Sidebar = ({ isOpen = false, onClose = () => {} }) => {
  const admin = getUser();
  const currentRole = normalizeRole(admin?.role);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [openGroups, setOpenGroups] = React.useState({});

  const fullName = `${admin?.firstName || ''} ${admin?.lastName || ''}`.trim() || 'Admin Control';
  const resolvedAdminImage = resolveImageUrl(admin?.image);
  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  const visibleOwnerLinks = React.useMemo(
    () =>
      ownerMenuLinks.filter((link) => {
        const permissionAllowed = !link.permission || hasPermission(link.permission);
        const roleAllowed = !Array.isArray(link.roles) || link.roles.length === 0 || link.roles.includes(currentRole);
        return permissionAllowed && roleAllowed;
      }),
    [currentRole],
  );

  const linkByPath = React.useMemo(() => {
    const map = new Map();
    visibleOwnerLinks.forEach((link) => {
      map.set(link.path, link);
    });
    return map;
  }, [visibleOwnerLinks]);

  const buildRouteItem = React.useCallback(
    (path, name, icon) => {
      const link = linkByPath.get(path);
      if (!link) return null;
      return {
        key: path,
        type: 'route',
        path,
        name: name || link.name,
        icon,
        searchText: `${name || link.name} ${path}`,
      };
    },
    [linkByPath],
  );

  const handleOpenMessagingCenter = React.useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.set('chat', 'open');
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: false },
    );
  }, [location.pathname, location.search, navigate]);

  const navSections = React.useMemo(
    () =>
      [
        {
          id: 'core',
          title: 'Core',
          items: [
            buildRouteItem('/owner', 'Dashboard', DashboardRoundedIcon),
            buildRouteItem('/owner/analytics', 'Analytics', BarChartRoundedIcon),
            buildRouteItem('/owner/profile', 'Profile', PersonRoundedIcon),
          ].filter(Boolean),
        },
        {
          id: 'bookings',
          title: 'Bookings',
          items: [
            buildRouteItem('/owner/manage-bookings', 'Manage Bookings', CalendarMonthRoundedIcon),
            buildRouteItem('/owner/bookings', 'Active Rentals', EventAvailableRoundedIcon),
            buildRouteItem('/owner/rental-tracking', 'Rental Tracking', TimelineRoundedIcon),
          ].filter(Boolean),
        },
        {
          id: 'fleet-management',
          title: 'Fleet Management',
          items: [
            buildRouteItem('/owner/add-car', 'Add Car', AddCircleRoundedIcon),
            buildRouteItem('/owner/manage-cars', 'Manage Cars', DirectionsCarRoundedIcon),
            buildRouteItem('/owner/fleet-overview', 'Fleet Overview', ViewTimelineRoundedIcon),
            buildRouteItem('/owner/drivers', 'Drivers', DriveEtaRoundedIcon),
            buildRouteItem('/owner/categories', 'Categories', CategoryRoundedIcon),
          ].filter(Boolean),
        },
        {
          id: 'customer-management',
          title: 'Customer Management',
          items: [
            buildRouteItem('/owner/users', 'Manage Users', PeopleRoundedIcon),
            buildRouteItem('/owner/reviews', 'Manage Reviews', RateReviewRoundedIcon),
            buildRouteItem('/owner/offers', 'Manage Offers', LocalOfferRoundedIcon),
          ].filter(Boolean),
        },
        {
          id: 'subscriptions',
          title: 'Subscriptions',
          items: [
            buildRouteItem('/owner/subscription-plans', 'Subscription Plans', CardMembershipRoundedIcon),
            buildRouteItem('/owner/manage-subscriptions', 'Manage Subscriptions', PlaylistAddCheckRoundedIcon),
            buildRouteItem('/owner/deposit-rules', 'Deposit Rules', SavingsRoundedIcon),
          ].filter(Boolean),
        },
        {
          id: 'locations',
          title: 'Locations',
          items: [
            buildRouteItem('/owner/branches', 'Branches', LocationOnRoundedIcon),
            buildRouteItem('/owner/locations', 'Locations', PlaceRoundedIcon),
          ].filter(Boolean),
        },
        {
          id: 'communication',
          title: 'Communication',
          items: [
            buildRouteItem('/owner/auto-messages', 'Auto Messages', CampaignRoundedIcon),
            {
              key: 'messaging-center',
              type: 'action',
              name: 'Messaging Center',
              icon: ChatRoundedIcon,
              onClick: handleOpenMessagingCenter,
              searchText: 'Messaging Center chat',
            },
          ].filter(Boolean),
        },
        {
          id: 'system',
          title: 'System',
          items: [
            buildRouteItem('/owner/manage-roles', 'Manage Roles', AdminPanelSettingsRoundedIcon),
            buildRouteItem('/owner/platform-overview', 'Platform Overview', PublicRoundedIcon),
            buildRouteItem('/owner/settings', 'Settings', SettingsRoundedIcon),
          ].filter(Boolean),
        },
      ].filter((section) => section.items.length > 0),
    [buildRouteItem, handleOpenMessagingCenter],
  );

  React.useEffect(() => {
    setOpenGroups((previous) => {
      const nextState = { ...previous };
      navSections.forEach((section, index) => {
        if (typeof nextState[section.id] !== 'boolean') {
          const hasActiveRoute = section.items.some(
            (item) => item.type === 'route' && item.path === location.pathname,
          );
          nextState[section.id] = hasActiveRoute || index < 2;
        }
      });
      return nextState;
    });
  }, [location.pathname, navSections]);

  React.useEffect(() => {
    const activeSection = navSections.find((section) =>
      section.items.some((item) => item.type === 'route' && item.path === location.pathname),
    );
    if (!activeSection?.id) return;
    setOpenGroups((previous) => {
      if (previous[activeSection.id]) return previous;
      return {
        ...previous,
        [activeSection.id]: true,
      };
    });
  }, [location.pathname, navSections]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredSections = React.useMemo(() => {
    if (!normalizedSearch) return navSections;
    return navSections
      .map((section) => {
        const matchedItems = section.items.filter((item) => {
          const haystack = String(item.searchText || item.name || '').toLowerCase();
          return haystack.includes(normalizedSearch);
        });
        return {
          ...section,
          items: matchedItems,
        };
      })
      .filter((section) => section.items.length > 0);
  }, [navSections, normalizedSearch]);

  return (
    <>
      {isOpen ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="owner-sidebar__backdrop is-visible"
          onClick={onClose}
        />
      ) : null}

      <aside id="owner-sidebar" className={`owner-sidebar ${isOpen ? 'is-open' : ''}`}>
        <div className="owner-sidebar__glow owner-sidebar__glow--top" aria-hidden="true" />
        <div className="owner-sidebar__glow owner-sidebar__glow--bottom" aria-hidden="true" />

        <div className="owner-sidebar__profile">
          <div className="owner-sidebar__avatar-shell">
            {resolvedAdminImage ? (
              <img src={resolvedAdminImage} alt="admin avatar" className="owner-sidebar__avatar-image" />
            ) : (
              <span className="owner-sidebar__avatar-fallback">{initials || 'AD'}</span>
            )}
          </div>

          <div className="owner-sidebar__meta">
            <p className="owner-sidebar__name">{fullName}</p>
            <p className="owner-sidebar__role">{normalizeRole(admin?.role).toUpperCase()}</p>
          </div>

          <button
            type="button"
            className="owner-sidebar__edit"
            onClick={() => {
              navigate('/owner/profile');
              onClose();
            }}
            aria-label="Edit profile"
            title="Edit profile"
          >
            <img src={assets.edit_icon} alt="" />
          </button>
        </div>

        <div className="owner-sidebar__appearance">
          <p className="owner-sidebar__group-title owner-sidebar__group-title--compact">Appearance</p>
          <ThemeToggle className="owner-sidebar__theme-toggle" showLabel />
        </div>

        <SidebarSearch value={searchQuery} onChange={setSearchQuery} />

        <nav className="owner-sidebar__nav" aria-label="Admin navigation">
          {filteredSections.length > 0 ? (
            filteredSections.map((section) => (
              <SidebarGroup
                key={section.id}
                section={section}
                activePath={location.pathname}
                isExpanded={normalizedSearch ? true : Boolean(openGroups[section.id])}
                forceExpanded={Boolean(normalizedSearch)}
                onToggle={(sectionId) =>
                  setOpenGroups((previous) => ({
                    ...previous,
                    [sectionId]: !previous[sectionId],
                  }))
                }
                onNavigate={onClose}
              />
            ))
          ) : (
            <p className="owner-sidebar__search-empty">No modules matched your search.</p>
          )}
        </nav>

        <button
          type="button"
          className="owner-sidebar__home-btn"
          onClick={() => {
            navigate('/');
            onClose();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5 12 3l9 7.5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 9.5V21h14V9.5" />
          </svg>
          <span>Back To Home</span>
        </button>
      </aside>
    </>
  );
};

export default Sidebar;
