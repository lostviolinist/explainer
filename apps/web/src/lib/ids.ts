/** Project ids are UUIDs. Anything else is a bad link: not found, never a database query. */
export const isProjectId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
