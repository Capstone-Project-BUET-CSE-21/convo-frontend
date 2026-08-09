import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PropTypes from "prop-types";
import { saveAuthSession } from "../auth/authSession";
import "./AuthPage.css";
import { ensureUserHasKeys } from "../crypto/keypair";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const emptyLoginForm = { email: "", password: "" };
const emptySignupForm = {
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
};

const EyeIcon = ({ open }) => (
    <img
        src={open ? "/open.png" : "/close.png"}
        alt={open ? "Hide password" : "Show password"}
        className="eye-icon"
    />
);

EyeIcon.propTypes = {
    open: PropTypes.bool.isRequired,
};

const ArrowIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
    </svg>
);

const Field = ({ label, children }) => (
    <div className="auth-field">
        <label className="auth-label">{label}</label>
        {children}
    </div>
);

Field.propTypes = {
    label: PropTypes.string.isRequired,
    children: PropTypes.node.isRequired,
};

const TextField = ({ label, ...props }) => (
    <Field label={label}>
        <input className="auth-input" {...props} />
    </Field>
);


TextField.propTypes = {
    label: PropTypes.string.isRequired,
    value: PropTypes.any,
    onChange: PropTypes.func,
};

const PasswordField = ({ label, isVisible, onToggle, ...props }) => (
    <Field label={label}>
        <div className="auth-input-wrap">
            <input
                className="auth-input has-toggle"
                type={isVisible ? "text" : "password"}
                {...props}
            />
            <button
                type="button"
                className="auth-toggle-btn"
                onClick={onToggle}
                aria-label={isVisible ? "Hide password" : "Show password"}
            >
                <EyeIcon open={isVisible} />
            </button>
        </div>
    </Field>
);

PasswordField.propTypes = {
    label: PropTypes.string.isRequired,
    isVisible: PropTypes.bool,
    onToggle: PropTypes.func,
};

const AuthPage = ({ onAuthSuccess, onNewDevice }) => {
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
        return () => Object.values(timers).forEach(clearTimeout);
    }, []);

    const togglePasswordVisibility = (field) => {
        setShowPasswords((current) => {
            const next = !current[field];
            if (hideTimersRef.current[field]) {
                clearTimeout(hideTimersRef.current[field]);
                delete hideTimersRef.current[field];
            }
            if (next) {
                hideTimersRef.current[field] = setTimeout(() => {
                    setShowPasswords((latest) => ({ ...latest, [field]: false }));
                    delete hideTimersRef.current[field];
                }, 3000);
            }
            return { ...current, [field]: next };
        });
    };

    const switchMode = (nextMode) => {
        setMode(nextMode);
        setError("");
        setFeedback("");
    };

    const updateField = (setter, field) => (e) =>
        setter((cur) => ({ ...cur, [field]: e.target.value }));

    const handleLoginSubmit = (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        if (!loginForm.email.trim() || !loginForm.password.trim()) {
            setError("Enter both email and password to continue.");
            return;
        }
        (async () => {
            setIsSubmitting(true);
            setError("");
            setFeedback("");
            try {
                const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: loginForm.email.trim(),
                        password: loginForm.password,
                    }),
                });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(payload?.message || "Login failed. Please check your credentials.");
                saveAuthSession(payload);
                const keyStatus = await ensureUserHasKeys(payload.user.id);
                if (keyStatus?.status === "new-device") onNewDevice();
                onAuthSuccess(payload.user);
                setFeedback("Login successful. Redirecting…");
                navigate("/home", { replace: true });
            } catch (err) {
                setError(err.message || "Login failed.");
            } finally {
                setIsSubmitting(false);
            }
        })();
    };

    const handleSignupSubmit = (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        const vals = [signupForm.firstName, signupForm.lastName, signupForm.email, signupForm.password, signupForm.confirmPassword];
        if (vals.some((v) => !v.trim())) {
            setError("Fill in every field before creating an account.");
            return;
        }
        if (signupForm.password !== signupForm.confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        (async () => {
            setIsSubmitting(true);
            setError("");
            setFeedback("");
            try {
                const res = await fetch(`${API_BASE_URL}/api/auth/signup`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        firstName: signupForm.firstName.trim(),
                        lastName: signupForm.lastName.trim(),
                        email: signupForm.email.trim(),
                        password: signupForm.password,
                        confirmPassword: signupForm.confirmPassword,
                    }),
                });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(payload?.message || "Signup failed. Please try different credentials.");
                saveAuthSession(payload);
                const keyStatus = await ensureUserHasKeys(payload.user.id);
                if (keyStatus?.status === "new-device") onNewDevice();
                onAuthSuccess(payload.user);
                setFeedback("Account created. Redirecting…");
                navigate("/home", { replace: true });
            } catch (err) {
                setError(err.message || "Signup failed.");
            } finally {
                setIsSubmitting(false);
            }
        })();
    };

    return (
        <div className="auth-page">
            {/* Left intro panel */}
            <section className="auth-intro">
                <div className="auth-intro-content">
                    <div className="auth-intro-text">
                        <h1>
                            Where <em>conversations</em> create momentum.
                        </h1>
                        <div className="auth-intro-footnote">
                            <span className="auth-intro-dot">Audio Watermarking</span>
                            <span className="auth-intro-dot">Confidentiality Chain in File Sharing</span>
                        </div>
                    </div>
                    <div className="auth-intro-image">
                        <img src="/auth.png" alt="Convo illustration" />
                    </div>
                </div>
            </section>

            {/* Right auth panel */}
            <section className="auth-panel" aria-labelledby="auth-title">
                <div className="auth-brand-mark">
                    <div className="auth-brand-logo" aria-hidden="true">
                        <img className="logo-image"
                            src="/convo-logo-1.png"
                            alt="Convo Logo"
                        />
                    </div>
                    <span className="auth-brand-name">Convo</span>
                </div>

                <h2 id="auth-title" className="auth-heading">
                    {mode === "login" ? "Welcome back" : "Create account"}
                </h2>
                <p className="auth-subheading">
                    {mode === "login"
                        ? "Sign in to access your workspace."
                        : "Join your team on Convo today."}
                </p>

                <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
                    <button
                        type="button"
                        className={`auth-tab${mode === "login" ? " active" : ""}`}
                        onClick={() => switchMode("login")}
                        aria-pressed={mode === "login"}
                        disabled={isSubmitting}
                    >
                        Sign in
                    </button>
                    <button
                        type="button"
                        className={`auth-tab${mode === "signup" ? " active" : ""}`}
                        onClick={() => switchMode("signup")}
                        aria-pressed={mode === "signup"}
                        disabled={isSubmitting}
                    >
                        Sign up
                    </button>
                </div>

                <div className="auth-status" aria-live="polite">
                    {error && <p className="auth-message error">{error}</p>}
                    {feedback && <p className="auth-message success">{feedback}</p>}
                </div>

                {mode === "login" ? (
                    <form className="auth-form" onSubmit={handleLoginSubmit} noValidate>
                        <TextField
                            label="Email"
                            type="email"
                            name="login-email"
                            placeholder="you@example.com"
                            value={loginForm.email}
                            onChange={updateField(setLoginForm, "email")}
                            autoComplete="email"
                        />
                        <PasswordField
                            label="Password"
                            name="login-password"
                            placeholder="Enter your password"
                            value={loginForm.password}
                            onChange={updateField(setLoginForm, "password")}
                            autoComplete="current-password"
                            isVisible={showPasswords.loginPassword}
                            onToggle={() => togglePasswordVisibility("loginPassword")}
                        />
                        <div className="auth-actions">
                            <button
                                type="submit"
                                className="auth-btn-primary"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? "Signing in…" : "Continue to workspace"}
                                {!isSubmitting && <ArrowIcon />}
                            </button>
                        </div>
                    </form>
                ) : (
                    <form className="auth-form" onSubmit={handleSignupSubmit} noValidate>
                        <div className="auth-grid-two">
                            <TextField
                                label="First name"
                                type="text"
                                name="first-name"
                                placeholder="First name"
                                value={signupForm.firstName}
                                onChange={updateField(setSignupForm, "firstName")}
                                autoComplete="given-name"
                            />
                            <TextField
                                label="Last name"
                                type="text"
                                name="last-name"
                                placeholder="Last name"
                                value={signupForm.lastName}
                                onChange={updateField(setSignupForm, "lastName")}
                                autoComplete="family-name"
                            />
                        </div>
                        <TextField
                            label="Email"
                            type="email"
                            name="signup-email"
                            placeholder="you@example.com"
                            value={signupForm.email}
                            onChange={updateField(setSignupForm, "email")}
                            autoComplete="email"
                        />
                        <div className="auth-grid-two">
                            <PasswordField
                                label="Password"
                                name="signup-password"
                                placeholder="Create password"
                                value={signupForm.password}
                                onChange={updateField(setSignupForm, "password")}
                                autoComplete="new-password"
                                isVisible={showPasswords.signupPassword}
                                onToggle={() => togglePasswordVisibility("signupPassword")}
                            />
                            <PasswordField
                                label="Confirm"
                                name="confirm-password"
                                placeholder="Confirm password"
                                value={signupForm.confirmPassword}
                                onChange={updateField(setSignupForm, "confirmPassword")}
                                autoComplete="new-password"
                                isVisible={showPasswords.confirmPassword}
                                onToggle={() => togglePasswordVisibility("confirmPassword")}
                            />
                        </div>
                        <div className="auth-actions">
                            <button
                                type="submit"
                                className="auth-btn-primary"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? "Creating account…" : "Create account"}
                                {!isSubmitting && <ArrowIcon />}
                            </button>
                        </div>
                    </form>
                )}

                <footer className="auth-footer">
                    By continuing you agree to our{" "}
                    <a href="#">Terms of Service</a> and{" "}
                    <a href="#">Privacy Policy</a>.
                </footer>
            </section>
        </div>
    );
};

AuthPage.propTypes = {
    onAuthSuccess: PropTypes.func,
    onNewDevice: PropTypes.func,
};

AuthPage.defaultProps = {
    onAuthSuccess: () => { },
    onNewDevice: () => { },
};

export default AuthPage;