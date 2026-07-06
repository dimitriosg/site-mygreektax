import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    seoTitle: z.string().optional(),
    description: z.string(),
    category: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
    readingTime: z.string().optional(),
    draft: z.boolean().default(false),
    ogImage: z.string().optional(),
  }),
});

export const collections = { blog };
