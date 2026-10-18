export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard/', '/onboarding/', '/api/', '/learn/'],
    },
    sitemap: 'https://www.mybenchcoach.com/sitemap.xml', // ← Added www
  }
}
