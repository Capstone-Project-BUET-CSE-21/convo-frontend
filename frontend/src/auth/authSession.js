const AUTH_TOKEN_KEY = "convo_auth_token";
const AUTH_USER_KEY = "convo_auth_user";

export const saveAuthSession = (authResponse) => {
    if (!authResponse?.token || !authResponse?.user) {
        return;
    }

    localStorage.setItem(AUTH_TOKEN_KEY, authResponse.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(authResponse.user));
};

export const getAuthToken = () => localStorage.getItem(AUTH_TOKEN_KEY);

export const getAuthUser = () => {
    const rawUser = localStorage.getItem(AUTH_USER_KEY);
    if (!rawUser) {
        return null;
    }

    try {
        return JSON.parse(rawUser);
    } catch {
        clearAuthSession();
        return null;
    }
};

export const clearAuthSession = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
};
