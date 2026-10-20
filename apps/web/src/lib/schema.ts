import { pgTable, text, uuid, integer, doublePrecision, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One video. The question is the only user input. */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    question: text("question").notNull(),
    /** Clean sentence-case title, written by the intake stage; null for projects made before it existed. */
    title: text("title"),
    style: text("style").notNull().default("illustrated"), // illustrated | math
    stage: text("stage").notNull().default("queued"),
    parentId: uuid("parent_id"),
    reaction: text("reaction"), // simpler | deeper | follow-up
    shareSlug: text("share_slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("projects_share_slug").on(t.shareSlug), index("projects_user").on(t.userId)],
);

/** Versioned stage outputs. The orchestrator is the only writer. */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // brief | research | plan | sceneAssets | render
    sceneId: text("scene_id"),
    version: integer("version").notNull().default(1),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("artifacts_lookup").on(t.projectId, t.kind, t.sceneId, t.version)],
);

export const progressEvents = pgTable(
  "progress_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    message: text("message").notNull(),
    fraction: doublePrecision("fraction").notNull(),
    preview: jsonb("preview"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("progress_project_at").on(t.projectId, t.at)],
);

export const costs = pgTable(
  "costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    usd: doublePrecision("usd").notNull(),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("costs_project").on(t.projectId)],
);
