'use client';
import type { OverviewCtx } from './CompanyPage';
import Explorer from './Explorer';

export default function TabBerita({ data }: OverviewCtx) {
  return <div id="exploreMount" style={{ marginTop: 18 }}><Explorer feedKey={data.company.id} company={data.company.id} /></div>;
}
