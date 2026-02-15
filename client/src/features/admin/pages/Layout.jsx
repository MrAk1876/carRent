import React from 'react'
import NavbarOwner from '../components/NavbarOwner'
import Sidebar from '../components/Sidebar'
import { Outlet } from 'react-router-dom'

const Layout = () => {
  return (
    <div className='flex h-dvh flex-col overflow-hidden bg-slate-50/40'>
      <div className='shrink-0'>
        <NavbarOwner />
      </div>
      <div className='flex min-h-0 flex-1'>
        <Sidebar />
        <main className='min-w-0 flex-1 overflow-y-auto overflow-x-hidden'>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default Layout
