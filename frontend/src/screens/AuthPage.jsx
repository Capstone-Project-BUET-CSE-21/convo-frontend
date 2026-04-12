import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PropTypes from "prop-types";
import {
    AuthPasswordField,
    AuthPrimaryButton,
    AuthTextField,
} from "../components/SharedComponents";
import { saveAuthSession } from "../auth/authSession";
import "./AuthPage.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const emptyLoginForm = {
    email: "",
    password: "",
};

const emptySignupForm = {
    firstName: "",
    lastName: "",
    userName: "",
    email: "",
    password: "",
    confirmPassword: "",
};

const AuthPage = ({ onAuthSuccess }) => {
    const navigate = useNavigate();
    const [mode, setMode] = useState("login");
    const [loginForm, setLoginForm] = useState(emptyLoginForm);
    const [signupForm, setSignupForm] = useState(emptySignupForm);
    const [feedback, setFeedback] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPasswords, setShowPasswords] = useState({
        loginPassword: false,
        signupPassword: false,
        confirmPassword: false,
    });
    const hideTimersRef = useRef({});

    useEffect(() => {
        const timers = hideTimersRef.current;
        return () => {
            Object.values(timers).forEach((timer) => {
                clearTimeout(timer);
            });
        };
    }, []);

    const togglePasswordVisibility = (field) => {
        setShowPasswords((current) => {
            const nextValue = !current[field];

            if (hideTimersRef.current[field]) {
                clearTimeout(hideTimersRef.current[field]);
                delete hideTimersRef.current[field];
            }

            if (nextValue) {
                hideTimersRef.current[field] = setTimeout(() => {
                    setShowPasswords((latest) => ({
                        ...latest,
                        [field]: false,
                    }));
                    delete hideTimersRef.current[field];
                }, 3000);
            }

            return {
                ...current,
                [field]: nextValue,
            };
        });
    };

    const switchMode = (nextMode) => {
        setMode(nextMode);
        setError("");
        setFeedback("");
    };

    const updateLoginField = (field) => (event) => {
        setLoginForm((current) => ({
            ...current,
            [field]: event.target.value,
        }));
    };

    const updateSignupField = (field) => (event) => {
        setSignupForm((current) => ({
            ...current,
            [field]: event.target.value,
        }));
    };

    const handleLoginSubmit = (event) => {
        event.preventDefault();

        if (isSubmitting) {
            return;
        }

        if (!loginForm.email.trim() || !loginForm.password.trim()) {
            setError("Enter both email and password to continue.");
            setFeedback("");
            return;
        }

        const submitLogin = async () => {
            setIsSubmitting(true);
            setError("");
            setFeedback("");

            try {
                const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        email: loginForm.email.trim(),
                        password: loginForm.password,
                    }),
                });

                const payload = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(payload?.message || "Login failed. Please check your credentials.");
                }

                saveAuthSession(payload);
                onAuthSuccess(payload.user);
                setFeedback("Login successful. Redirecting to home...");
                navigate("/home", { replace: true });
            } catch (err) {
                setError(err.message || "Login failed.");
            } finally {
                setIsSubmitting(false);
            }
        };

        submitLogin();
    };

    const handleSignupSubmit = (event) => {
        event.preventDefault();

        if (isSubmitting) {
            return;
        }

        const requiredFields = [
            signupForm.firstName,
            signupForm.lastName,
            signupForm.userName,
            signupForm.email,
            signupForm.password,
            signupForm.confirmPassword,
        ];

        if (requiredFields.some((value) => !value.trim())) {
            setError("Fill in every signup field before creating an account.");
            setFeedback("");
            return;
        }

        if (signupForm.password !== signupForm.confirmPassword) {
            setError("Passwords do not match.");
            setFeedback("");
            return;
        }

        const submitSignup = async () => {
            setIsSubmitting(true);
            setError("");
            setFeedback("");

            try {
                const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        firstName: signupForm.firstName.trim(),
                        lastName: signupForm.lastName.trim(),
                        userName: signupForm.userName.trim(),
                        email: signupForm.email.trim(),
                        password: signupForm.password,
                        confirmPassword: signupForm.confirmPassword,
                    }),
                });

                const payload = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(payload?.message || "Signup failed. Please try different credentials.");
                }

                saveAuthSession(payload);
                onAuthSuccess(payload.user);
                setFeedback("Signup successful. Redirecting to home...");
                navigate("/home", { replace: true });
            } catch (err) {
                setError(err.message || "Signup failed.");
            } finally {
                setIsSubmitting(false);
            }
        };

        submitSignup();
    };

    return (
        <div className="auth-page">
            <section className="auth-intro">
                <span className="auth-kicker">Convo access portal</span>
                <h1>Sign in or create your account to join the workspace.</h1>
            </section>

            <section className="auth-card" aria-labelledby="auth-title">
                <div className="auth-card-header">
                    <div>
                        <p className="auth-brand">Convo</p>
                        <h2 id="auth-title">{mode === "login" ? "Welcome back" : "Create an account"}</h2>
                    </div>

                    <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
                        <button
                            type="button"
                            className={mode === "login" ? "auth-tab active" : "auth-tab"}
                            onClick={() => switchMode("login")}
                            aria-pressed={mode === "login"}
                            disabled={isSubmitting}
                        >
                            Login
                        </button>
                        <button
                            type="button"
                            className={mode === "signup" ? "auth-tab active" : "auth-tab"}
                            onClick={() => switchMode("signup")}
                            aria-pressed={mode === "signup"}
                            disabled={isSubmitting}
                        >
                            Sign up
                        </button>
                    </div>
                </div>

                <div className="auth-status" aria-live="polite">
                    {error ? <p className="auth-message error">{error}</p> : null}
                    {feedback ? <p className="auth-message success">{feedback}</p> : null}
                </div>

                {mode === "login" ? (
                    <form className="auth-form" onSubmit={handleLoginSubmit}>
                        <AuthTextField
                            label="Email"
                            type="email"
                            name="login-email"
                            placeholder="you@example.com"
                            value={loginForm.email}
                            onChange={updateLoginField("email")}
                            autoComplete="email"
                        />

                        <AuthPasswordField
                            label="Password"
                            name="login-password"
                            placeholder="Enter your password"
                            value={loginForm.password}
                            onChange={updateLoginField("password")}
                            autoComplete="current-password"
                            isVisible={showPasswords.loginPassword}
                            onToggle={() => togglePasswordVisibility("loginPassword")}
                        />

                        <div className="auth-actions auth-actions-single">
                            <AuthPrimaryButton>
                                {isSubmitting ? "Signing in..." : "Continue to workspace"}
                            </AuthPrimaryButton>
                        </div>
                    </form>
                ) : (
                    <form className="auth-form" onSubmit={handleSignupSubmit}>
                        <div className="auth-grid-two">
                            <AuthTextField
                                label="First name"
                                type="text"
                                name="first-name"
                                placeholder="First Name"
                                value={signupForm.firstName}
                                onChange={updateSignupField("firstName")}
                                autoComplete="given-name"
                            />

                            <AuthTextField
                                label="Last name"
                                type="text"
                                name="last-name"
                                placeholder="Last Name"
                                value={signupForm.lastName}
                                onChange={updateSignupField("lastName")}
                                autoComplete="family-name"
                            />
                        </div>

                        <AuthTextField
                            label="User name"
                            type="text"
                            name="user-name"
                            placeholder="username"
                            value={signupForm.userName}
                            onChange={updateSignupField("userName")}
                            autoComplete="username"
                        />

                        <AuthTextField
                            label="Email"
                            type="email"
                            name="signup-email"
                            placeholder="email"
                            value={signupForm.email}
                            onChange={updateSignupField("email")}
                            autoComplete="email"
                        />

                        <div className="auth-grid-two">
                            <AuthPasswordField
                                label="Password"
                                name="signup-password"
                                placeholder="Create password"
                                value={signupForm.password}
                                onChange={updateSignupField("password")}
                                autoComplete="new-password"
                                isVisible={showPasswords.signupPassword}
                                onToggle={() => togglePasswordVisibility("signupPassword")}
                            />

                            <AuthPasswordField
                                label="Confirm password"
                                name="confirm-password"
                                placeholder="Confirm password"
                                value={signupForm.confirmPassword}
                                onChange={updateSignupField("confirmPassword")}
                                autoComplete="new-password"
                                isVisible={showPasswords.confirmPassword}
                                onToggle={() => togglePasswordVisibility("confirmPassword")}
                            />
                        </div>

                        <div className="auth-actions">
                            <AuthPrimaryButton>{isSubmitting ? "Creating account..." : "Create account"}</AuthPrimaryButton>
                        </div>
                    </form>
                )}
            </section>
        </div>
    );
};

AuthPage.propTypes = {
    onAuthSuccess: PropTypes.func,
};

AuthPage.defaultProps = {
    onAuthSuccess: () => {},
};

export default AuthPage;