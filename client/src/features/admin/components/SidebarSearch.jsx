import React from 'react';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';

const SidebarSearch = ({ value = '', onChange = () => {} }) => (
  <label className="owner-sidebar__search" aria-label="Filter sidebar modules">
    <SearchRoundedIcon className="owner-sidebar__search-icon" />
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Search modules..."
      className="owner-sidebar__search-input"
    />
  </label>
);

export default SidebarSearch;
