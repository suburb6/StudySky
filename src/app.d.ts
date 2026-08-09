declare global {
  namespace App {
    interface Locals {
      user: {
        id: string;
        email: string;
        name: string;
        role: 'admin' | 'member';
        timezone: string;
      } | null;
      sessionId: string | null;
      clientAddress: string;
    }

    interface PageData {
      user?: App.Locals['user'];
    }
  }
}

export {};
