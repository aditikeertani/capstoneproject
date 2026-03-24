import React, { useState } from "react";
import { authLogin, authRegister } from "../api";

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    if (mode === "register") {
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setLoading(true);
    try {
      const result =
        mode === "register"
          ? await authRegister(email, password, name)
          : await authLogin(email, password);
      if (result?.token) {
        localStorage.setItem("auth_jwt", result.token);
        onLogin?.(result.token);
      } else {
        setError("No token returned from server.");
      }
    } catch (e) {
      setError(e.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f7f7f9",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "white",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>
          {mode === "register" ? "Create Account" : "Sign In"}
        </h1>
        <p style={{ color: "#555", marginTop: 0, marginBottom: 16 }}>
          Use your Gmail address to create an account or sign in.
        </p>

        {error && (
          <div
            style={{
              padding: 10,
              backgroundColor: "#ffebee",
              color: "#c62828",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setMode("login")}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              backgroundColor: mode === "login" ? "#2196F3" : "#f5f5f5",
              color: mode === "login" ? "white" : "#333",
              cursor: "pointer",
            }}
          >
            Sign In
          </button>
          <button
            onClick={() => setMode("register")}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              backgroundColor: mode === "register" ? "#4CAF50" : "#f5f5f5",
              color: mode === "register" ? "white" : "#333",
              cursor: "pointer",
            }}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: "#555" }}>Name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 6,
                  border: "1px solid #ddd",
                  marginTop: 4,
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#555" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 6,
                border: "1px solid #ddd",
                marginTop: 4,
              }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#555" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 6,
                border: "1px solid #ddd",
                marginTop: 4,
              }}
            />
          </div>

          {mode === "register" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "#555" }}>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 6,
                  border: "1px solid #ddd",
                  marginTop: 4,
                }}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px 14px",
              backgroundColor: loading ? "#9bb7d6" : "#007bff",
              color: "white",
              border: "none",
              borderRadius: 8,
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {loading
              ? "Please wait..."
              : mode === "register"
              ? "Create Account"
              : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
