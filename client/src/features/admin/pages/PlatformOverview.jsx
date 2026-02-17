import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import { isPlatformSuperAdmin } from '../../../utils/auth';

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
});

const PlatformOverview = () => {
  const canAccessPlatform = isPlatformSuperAdmin();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [tenants, setTenants] = useState([]);

  useEffect(() => {
    if (!canAccessPlatform) {
      setLoading(false);
      setError('');
      setSummary(null);
      setTenants([]);
      return undefined;
    }

    let active = true;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const overviewRes = await API.get('/platform/overview', {
          showErrorToast: false,
          timeout: 30000,
          maxRetries: 1,
        });
        if (!active) return;
        setSummary(overviewRes?.data?.summary || null);

        const tenantsRes = await API.get('/platform/tenants?page=1&pageSize=8', {
          showErrorToast: false,
          timeout: 30000,
          maxRetries: 1,
        });
        if (!active) return;
        setTenants(Array.isArray(tenantsRes?.data?.tenants) ? tenantsRes.data.tenants : []);
      } catch (apiError) {
        if (!active) return;
        setError(getErrorMessage(apiError, 'Failed to load platform overview'));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [canAccessPlatform]);

  const cards = useMemo(() => {
    const metrics = summary?.platformUtilizationMetrics || {};
    return [
      {
        title: 'Total Tenants',
        value: Number(summary?.totalTenants || 0),
      },
      {
        title: 'Total Revenue',
        value: currencyFormatter.format(Number(summary?.totalRevenue || 0)),
      },
      {
        title: 'Active Subscriptions',
        value: Number(summary?.activeSubscriptions || 0),
      },
      {
        title: 'Tenant Growth (30d)',
        value: `${percentFormatter.format(Number(summary?.tenantGrowthRate || 0))}%`,
      },
      {
        title: 'Fleet Utilization',
        value: `${percentFormatter.format(Number(metrics?.utilizationPercent || 0))}%`,
      },
      {
        title: 'Vehicles / Branches',
        value: `${Number(metrics?.totalVehicles || 0)} / ${Number(metrics?.totalBranches || 0)}`,
      },
    ];
  }, [summary]);

  if (!canAccessPlatform) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-700">
          Platform overview is available only for `PlatformSuperAdmin`.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="h-10 w-72 rounded bg-slate-200 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-28 rounded-2xl border border-slate-200 bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 text-red-700 px-4 py-3">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold text-slate-900">Platform Overview</h1>
        <p className="mt-1 text-slate-500">
          Multi-tenant SaaS intelligence across subscriptions, revenue, and utilization.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((card) => (
          <article key={card.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.title}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
          </article>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Tenants Snapshot</h2>
          <p className="text-sm text-slate-500">Recent 8 tenants</p>
        </header>

        {tenants.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500">No tenants found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Tenant</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Code</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Plan</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Usage</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant._id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{tenant.companyName}</p>
                      <p className="text-xs text-slate-500">{tenant.contactEmail || 'No contact email'}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{tenant.companyCode}</td>
                    <td className="px-4 py-3 text-slate-700">{tenant.subscriptionPlan}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          tenant.tenantStatus === 'Active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {tenant.tenantStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      B:{tenant.usage?.branches || 0} / V:{tenant.usage?.vehicles || 0} / U:{tenant.usage?.users || 0} / D:{tenant.usage?.drivers || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default PlatformOverview;
