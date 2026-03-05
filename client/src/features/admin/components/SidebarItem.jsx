import React from 'react';
import { NavLink } from 'react-router-dom';

const SidebarItem = ({
  item,
  onNavigate = () => {},
  isActive = false,
  style = undefined,
}) => {
  const Icon = item?.icon;

  if (item?.type === 'action') {
    return (
      <button
        type="button"
        className={`owner-sidebar__item owner-sidebar__item--action ${isActive ? 'is-active' : ''}`}
        onClick={() => {
          item?.onClick?.();
          onNavigate();
        }}
        style={style}
      >
        <span className="owner-sidebar__icon-wrap">
          {Icon ? <Icon className="owner-sidebar__icon" /> : null}
        </span>
        <span className="owner-sidebar__text">{item?.name}</span>
        <span className="owner-sidebar__indicator" aria-hidden="true" />
      </button>
    );
  }

  return (
    <NavLink
      to={item?.path || '/owner'}
      end={item?.path === '/owner'}
      onClick={onNavigate}
      className={({ isActive: active }) => `owner-sidebar__item ${active ? 'is-active' : ''}`}
      style={style}
    >
      <span className="owner-sidebar__icon-wrap">
        {Icon ? <Icon className="owner-sidebar__icon" /> : null}
      </span>
      <span className="owner-sidebar__text">{item?.name}</span>
      <span className="owner-sidebar__indicator" aria-hidden="true" />
    </NavLink>
  );
};

export default SidebarItem;
