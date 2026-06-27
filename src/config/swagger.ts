import path from 'path';
import swaggerJSDoc from 'swagger-jsdoc';

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'DreamScape API',
      version: '1.0.0',
      description:
        'REST API documentation for the DreamScape backend. Built with Node.js, Express, TypeScript, and MongoDB.',
      contact: {
        name: 'DreamScape Team',
      },
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT ?? 5001}`,
        description: 'Development server',
      },
    ],
  },
  // process.cwd() resolves to the directory where `npm run dev` is executed
  // (i.e. /…/DreamScape/BE), making these globs 100% stable regardless of
  // how __dirname resolves inside ts-node.
  apis: [
    path.join(process.cwd(), 'src/routes/*.ts'),
    path.join(process.cwd(), 'src/models/*.ts'),
  ],
};

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec;
