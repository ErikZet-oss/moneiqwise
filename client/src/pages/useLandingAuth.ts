import { useState, type FormEvent } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function getPasswordStrength(password: string) {
  const checks = {
    minLength: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const label = score <= 2 ? "Slabe" : score <= 3 ? "Stredne" : "Silne";
  return { checks, score, label };
}

export function useLandingAuth() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasskeySubmitting, setIsPasskeySubmitting] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginRememberMe, setLoginRememberMe] = useState(true);
  const [registerFirstName, setRegisterFirstName] = useState("");
  const [registerLastName, setRegisterLastName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerRememberMe, setRegisterRememberMe] = useState(true);
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [devResetToken, setDevResetToken] = useState("");
  const [authTab, setAuthTab] = useState("login");
  const registerStrength = getPasswordStrength(registerPassword);
  const resetStrength = getPasswordStrength(resetNewPassword);

  const refreshAuth = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/login", {
        email: loginEmail,
        password: loginPassword,
        rememberMe: loginRememberMe,
      });
      await refreshAuth();
      toast({ title: "Prihlasenie uspesne", description: "Vitaj spat." });
    } catch (error) {
      toast({
        title: "Prihlasenie zlyhalo",
        description: error instanceof Error ? error.message : "Skontroluj email a heslo.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitPasskeyLogin = async () => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      toast({
        title: "Passkey nie je podporovaný",
        description: "Tento prehliadač alebo zariadenie nepodporuje WebAuthn.",
        variant: "destructive",
      });
      return;
    }

    setIsPasskeySubmitting(true);
    try {
      const optionsResponse = await apiRequest(
        "POST",
        "/api/auth/passkeys/options/login",
        { email: loginEmail.trim() || undefined },
      );
      const optionsPayload = (await optionsResponse.json()) as {
        options?: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      };
      if (!optionsPayload.options) {
        throw new Error("Server nevrátil passkey challenge.");
      }

      const passkeyResponse = await startAuthentication({
        optionsJSON: optionsPayload.options,
      });
      await apiRequest("POST", "/api/auth/passkeys/verify/login", {
        response: passkeyResponse,
        rememberMe: loginRememberMe,
      });

      await refreshAuth();
      toast({ title: "Prihlásenie úspešné", description: "Vitaj späť." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Passkey prihlásenie zlyhalo.";
      toast({
        title: "Passkey prihlásenie zlyhalo",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsPasskeySubmitting(false);
    }
  };

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: registerFirstName,
          lastName: registerLastName,
          email: registerEmail,
          password: registerPassword,
          rememberMe: registerRememberMe,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        pendingApproval?: boolean;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : "Registrácia zlyhala.");
      }
      if (data.pendingApproval) {
        toast({
          title: "Žiadosť odoslaná",
          description:
            "Tvoj účet čaká na schválenie správcom. Po schválení sa prihlás rovnakým emailom a heslom.",
        });
        setAuthTab("login");
        return;
      }
      await refreshAuth();
      toast({ title: "Registracia uspesna", description: "Ucet bol vytvoreny a si prihlaseny." });
    } catch (error) {
      toast({
        title: "Registracia zlyhala",
        description: error instanceof Error ? error.message : "Skus to prosim znova.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await apiRequest("POST", "/api/forgot-password", {
        email: forgotEmail,
      });
      const payload = await response.json();
      if (payload?.resetToken) {
        setDevResetToken(payload.resetToken);
        setResetEmail(forgotEmail.trim().toLowerCase());
      }
      toast({
        title: "Reset token vytvoreny",
        description: payload?.resetToken
          ? "Skopiruj token nizsie a nastav nove heslo."
          : "Ak ucet existuje, poslali sme instrukcie.",
      });
    } catch (error) {
      toast({
        title: "Zlyhalo vytvorenie reset tokenu",
        description: error instanceof Error ? error.message : "Skus to prosim znova.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/reset-password", {
        email: resetEmail,
        token: resetToken,
        newPassword: resetNewPassword,
      });
      setDevResetToken("");
      setResetToken("");
      setResetNewPassword("");
      toast({ title: "Heslo zmenene", description: "Teraz sa mozes prihlasit novym heslom." });
    } catch (error) {
      toast({
        title: "Reset hesla zlyhal",
        description: error instanceof Error ? error.message : "Skontroluj token a skus znova.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    toast,
    isSubmitting,
    isPasskeySubmitting,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginRememberMe,
    setLoginRememberMe,
    registerFirstName,
    setRegisterFirstName,
    registerLastName,
    setRegisterLastName,
    registerEmail,
    setRegisterEmail,
    registerPassword,
    setRegisterPassword,
    registerRememberMe,
    setRegisterRememberMe,
    forgotEmail,
    setForgotEmail,
    resetEmail,
    setResetEmail,
    resetToken,
    setResetToken,
    resetNewPassword,
    setResetNewPassword,
    devResetToken,
    authTab,
    setAuthTab,
    registerStrength,
    resetStrength,
    submitLogin,
    submitPasskeyLogin,
    submitRegister,
    submitForgotPassword,
    submitResetPassword,
  };
}

export type LandingAuth = ReturnType<typeof useLandingAuth>;
