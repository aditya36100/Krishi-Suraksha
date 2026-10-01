const { PrismaClient } = require('@prisma/client');

// PrismaClient singleton instance to prevent multiple connections in development
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
});

module.exports = prisma;
