import '@/styles/jobs.css';
import type { Metadata } from 'next';
import JobsView from '@/components/jobs/JobsView';

export const metadata: Metadata = { title: 'Task Runner' };

export default function JobsPage() {
  return <JobsView />;
}
