import { useEffect, useState } from "react";
import PropTypes from "prop-types";

const EyeOpenIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2 12.2a.8.8 0 0 1 0-.6c1.3-3 5-6.8 10-6.8s8.7 3.8 10 6.8a.8.8 0 0 1 0 .6c-1.3 3-5 6.8-10 6.8s-8.7-3.8-10-6.8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EyeClosedIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 4.5L19.5 21" />
        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
        <path d="M9.3 5.5A10.8 10.8 0 0 1 12 5.2c5 0 8.7 3.7 10 6.8a.8.8 0 0 1 0 .6 12.9 12.9 0 0 1-4.2 5.3" />
        <path d="M6.1 8.1A13 13 0 0 0 2 12.6a.8.8 0 0 0 0 .6c1.3 3.1 5 6.8 10 6.8a10 10 0 0 0 3.5-.6" />
    </svg>
);

export const AuthTextField = ({
    label,
    type,
    name,
    placeholder,
    value,
    onChange,
    autoComplete,
    required = true,
}) => (
    <label className="auth-field">
        <span>{label}</span>
        <input
            type={type}
            name={name}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            autoComplete={autoComplete}
            required={required}
        />
    </label>
);

export const AuthPasswordField = ({
    label,
    name,
    placeholder,
    value,
    onChange,
    autoComplete,
    isVisible,
    onToggle,
    required = true,
}) => (
    <label className="auth-field">
        <span>{label}</span>
        <div className="auth-password-input">
            <input
                type={isVisible ? "text" : "password"}
                name={name}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                autoComplete={autoComplete}
                required={required}
            />
            <button
                type="button"
                className="auth-password-toggle"
                onClick={onToggle}
                aria-label={isVisible ? "Hide password" : "Show password"}
            >
                {isVisible ? <EyeClosedIcon /> : <EyeOpenIcon />}
            </button>
        </div>
    </label>
);

export const AuthPrimaryButton = ({ children }) => (
    <button type="submit" className="auth-primary-button">
        {children}
    </button>
);

const ProfileIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
        <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
);

const CloseIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M18 6 6 18" />
        <path d="M6 6l12 12" />
    </svg>
);

export const AuthSidebar = ({ user, onNavigateHome, onLogout, currentPath }) => {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            window.addEventListener("keydown", handleKeyDown);
        }

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen]);

    useEffect(() => {
        const close = () => setIsOpen(false);
        close();
    }, [currentPath]);

    const displayName = user?.displayName || user?.userName || "User";
    const email = user?.email || "No email available";
    const initialsSource = (displayName || email).trim();
    const initials = initialsSource
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "U";

    return (
        <>
            {!isOpen ? 
            <button
                type="button"
                className="auth-profile-trigger"
                aria-label="Open profile menu"
                aria-controls="auth-sidebar-panel"
                onClick={() => setIsOpen(true)}
            >
                <ProfileIcon />
            </button> :
            <div className="auth-sidebar-backdrop" onClick={() => setIsOpen(false)} aria-hidden="true">
                <aside
                    id="auth-sidebar-panel"
                    className="auth-sidebar"
                    aria-label="Profile menu"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="auth-sidebar__header">
                        <div className="auth-sidebar__brand">
                            <div className="auth-sidebar__logo">{initials}</div>
                            <div>
                                <p className="auth-sidebar__eyebrow">Signed in as</p>
                                <h2 className="auth-sidebar__name">{displayName}</h2>
                            </div>
                        </div>

                        <button
                            type="button"
                            className="auth-sidebar__close"
                            onClick={() => setIsOpen(false)}
                            aria-label="Close profile menu"
                        >
                            <CloseIcon />
                        </button>
                    </div>

                    <div className="auth-sidebar__profile">
                        <span className="auth-sidebar__label">Profile</span>
                        <p className="auth-sidebar__value">{email}</p>
                    </div>

                    <div className="auth-sidebar__actions">
                        <button
                            type="button"
                            className={currentPath === "/home" ? "auth-sidebar__button active" : "auth-sidebar__button"}
                            onClick={() => {
                                setIsOpen(false);
                                onNavigateHome();
                            }}
                        >
                            Home
                        </button>
                        <button
                            type="button"
                            className="auth-sidebar__button logout"
                            onClick={() => {
                                setIsOpen(false);
                                onLogout();
                            }}
                        >
                            Logout
                        </button>
                    </div>
                </aside>
            </div>}
        </>
    );
};

AuthTextField.propTypes = {
    label: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    placeholder: PropTypes.string,
    value: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired,
    autoComplete: PropTypes.string,
    required: PropTypes.bool,
};

AuthTextField.defaultProps = {
    placeholder: "",
    autoComplete: undefined,
    required: true,
};

AuthPasswordField.propTypes = {
    label: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    placeholder: PropTypes.string,
    value: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired,
    autoComplete: PropTypes.string,
    isVisible: PropTypes.bool.isRequired,
    onToggle: PropTypes.func.isRequired,
    required: PropTypes.bool,
};

AuthPasswordField.defaultProps = {
    placeholder: "",
    autoComplete: undefined,
    required: true,
};

AuthPrimaryButton.propTypes = {
    children: PropTypes.node.isRequired,
};

AuthSidebar.propTypes = {
    user: PropTypes.shape({
        displayName: PropTypes.string,
        userName: PropTypes.string,
        email: PropTypes.string,
    }),
    onNavigateHome: PropTypes.func.isRequired,
    onLogout: PropTypes.func.isRequired,
    currentPath: PropTypes.string,
};

AuthSidebar.defaultProps = {
    user: null,
    currentPath: "",
};
