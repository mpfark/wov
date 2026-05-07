/**
 * Fetch all rows from a Supabase query, paging past the default 1,000-row PostgREST cap.
 *
 * Usage:
 *   const items = await fetchAllRows<Item>((from, to) =>
 *     supabase.from('items').select('*').order('name').range(from, to)
 *   );
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Hard cap to avoid runaway loops if something goes wrong.
  const maxPages = 100;
  for (let i = 0; i < maxPages; i++) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
