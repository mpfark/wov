export interface GuideCategory {
  id: string;
  key: string;
  title: string;
  subtitle: string | null;
  sort_order: number;
  is_published: boolean;
}

export interface GuideEntry {
  id: string;
  category_id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  sort_order: number;
  is_published: boolean;
}

/** The one entry whose read-state drives the toolbar attention dot (MVP rule). */
export const ATTENTION_SLUG = 'getting-started';
