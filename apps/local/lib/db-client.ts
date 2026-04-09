import { LOCAL_USER } from "./auth-mode";

export function createDbClient(): any {
  return {
    auth: {
      async getSession() {
        return {
          data: {
            session: {
              access_token: "local-token",
              refresh_token: "local-refresh",
              expires_in: 3600,
              user: {
                id: LOCAL_USER.id,
                email: LOCAL_USER.email,
                user_metadata: { name: LOCAL_USER.name, full_name: LOCAL_USER.name },
              },
            },
          },
          error: null,
        };
      },
      async signInWithOAuth() {
        return { error: new Error("Auth disabled in AGX Board local mode") };
      },
      async signOut() {
        return { error: null };
      },
      onAuthStateChange() {
        return {
          data: {
            subscription: {
              unsubscribe() {},
            },
          },
        };
      },
    },
    channel() {
      return {
        on() {
          return this;
        },
        subscribe() {
          return this;
        },
      };
    },
    removeChannel() {},
  };
}
