import React from 'react';
import { Collapse } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import SidebarItem from './SidebarItem';

const SidebarGroup = ({
  section,
  isExpanded = true,
  forceExpanded = false,
  onToggle = () => {},
  onNavigate = () => {},
  activePath = '',
}) => {
  const hasActiveRoute = section?.items?.some(
    (item) => item?.type === 'route' && String(item?.path || '') === String(activePath || ''),
  );

  return (
    <div className={`owner-sidebar__group ${hasActiveRoute ? 'has-active-route' : ''}`}>
      <button
        type="button"
        className={`owner-sidebar__group-toggle ${isExpanded ? 'is-open' : ''}`}
        onClick={() => {
          if (!forceExpanded) onToggle(section?.id);
        }}
      >
        <span className="owner-sidebar__group-title">{section?.title}</span>
        <ExpandMoreRoundedIcon className={`owner-sidebar__group-chevron ${isExpanded ? 'is-open' : ''}`} />
      </button>

      <Collapse in={isExpanded} timeout={220} unmountOnExit={false}>
        <div className="owner-sidebar__group-items">
          {(section?.items || []).map((item, index) => (
            <SidebarItem
              key={item?.key || item?.path || `${section?.id || 'group'}-${index}`}
              item={item}
              onNavigate={onNavigate}
              style={{ '--stagger-index': String(index) }}
            />
          ))}
        </div>
      </Collapse>
    </div>
  );
};

export default SidebarGroup;
