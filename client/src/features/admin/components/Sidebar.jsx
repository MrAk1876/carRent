import React from 'react';
import { assets, ownerMenuLinks } from '../../../assets/assets';
import { NavLink, useNavigate } from 'react-router-dom';
import { getUser } from '../../../utils/auth';
import './Sidebar.css';

const Sidebar = ({ isOpen = false, onClose = () => {} }) => {
  const admin = getUser();
  const navigate = useNavigate();

  const fullName = `${admin?.firstName || ''} ${admin?.lastName || ''}`.trim() || 'Admin Control';
  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  const coreSection = ownerMenuLinks.filter((link) => link.path === '/owner' || link.path === '/owner/profile');
  const operationsSection = ownerMenuLinks.filter((link) => link.path !== '/owner' && link.path !== '/owner/profile');
  const navSections = [
    { title: 'Core', links: coreSection },
    { title: 'Operations', links: operationsSection },
  ];

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation menu"
        aria-hidden={!isOpen}
        tabIndex={isOpen ? 0 : -1}
        className={`owner-sidebar__backdrop ${isOpen ? 'is-visible' : ''}`}
        onClick={onClose}
      />

      <aside id="owner-sidebar" className={`owner-sidebar ${isOpen ? 'is-open' : ''}`}>
        <div className="owner-sidebar__glow owner-sidebar__glow--top" aria-hidden="true" />
        <div className="owner-sidebar__glow owner-sidebar__glow--bottom" aria-hidden="true" />

        <div className="owner-sidebar__profile">
          <div className="owner-sidebar__avatar-shell">
            {admin?.image ? (
              <img src={admin.image} alt="admin avatar" className="owner-sidebar__avatar-image" />
            ) : (
              <span className="owner-sidebar__avatar-fallback">{initials || 'AD'}</span>
            )}
          </div>

          <div className="owner-sidebar__meta">
            <p className="owner-sidebar__name">{fullName}</p>
            <p className="owner-sidebar__role">{(admin?.role || 'admin').toUpperCase()}</p>
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

        <nav className="owner-sidebar__nav" aria-label="Admin navigation">
          {navSections.map((section) => (
            <div key={section.title} className="owner-sidebar__group">
              <p className="owner-sidebar__group-title">{section.title}</p>

              {section.links.map((link, index) => (
                <NavLink
                  key={link.path}
                  to={link.path}
                  end={link.path === '/owner'}
                  onClick={onClose}
                  className={({ isActive }) => `owner-sidebar__item ${isActive ? 'is-active' : ''}`}
                  style={{ '--stagger-index': String(index) }}
                >
                  {({ isActive }) => (
                    <>
                      <span className="owner-sidebar__icon-wrap">
                        <img
                          src={isActive ? link.coloredIcon : link.icon}
                          alt=""
                          className="owner-sidebar__icon"
                        />
                      </span>
                      <span className="owner-sidebar__text">{link.name}</span>
                      <span className="owner-sidebar__indicator" aria-hidden="true" />
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
