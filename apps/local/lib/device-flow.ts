
import { createAdminDbClient } from "@/lib/db-adapter";

export type DeviceCode = {
    device_code: string;
    user_code: string;
    status: "pending" | "approved" | "expired" | "denied";
    user_id?: string;
    access_token?: string;
    refresh_token?: string;
    created_at: string;
    expires_at: string;
};

// Generate a random user code (e.g. "ABCD-1234")
function generateUserCode(): string {
    const chars = "BCDFGHJKLMNPQRSTVWXZ";
    const nums = "23456789";

    let code = "";
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += "-";
    for (let i = 0; i < 4; i++) {
        code += nums.charAt(Math.floor(Math.random() * nums.length));
    }
    return code;
}

// Generate a random device code (long random string)
function generateDeviceCode(): string {
    return crypto.randomUUID();
}

export async function createDeviceCode() {
    const db = createAdminDbClient();
    const device_code = generateDeviceCode();
    const user_code = generateUserCode();

    // Expire in 15 minutes
    const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error } = await db
        .from("device_codes")
        .insert({
            device_code,
            user_code,
            status: "pending",
            expires_at
        });

    if (error) {
        console.error("[device-code] insert failed", {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        });
        throw error;
    }

    return {
        device_code,
        user_code,
        expires_in: 900, // 15 minutes
        interval: 5, // polling interval
    };
}

export async function getDeviceCode(deviceCode: string) {
    const db = createAdminDbClient();

    const { data, error } = await db
        .from("device_codes")
        .select("*")
        .eq("device_code", deviceCode)
        .single();

    if (error) {
        console.error("[device-code] fetch failed", {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        });
        return null;
    }
    return data as DeviceCode;
}

export async function approveDeviceCode(userCode: string, userId: string, tokens: { accessToken: string; refreshToken: string }) {
    const db = createAdminDbClient();

    // Verify code exists and is pending
    const { data, error: fetchError } = await db
        .from("device_codes")
        .select("*")
        .eq("user_code", userCode)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .single();

    if (fetchError || !data) {
        if (fetchError) {
            console.error("[device-code] approve fetch failed", {
                message: fetchError.message,
                code: fetchError.code,
                details: fetchError.details,
                hint: fetchError.hint
            });
        }
        return false;
    }

    // Update
    const { error } = await db
        .from("device_codes")
        .update({
            status: "approved",
            user_id: userId,
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken
        })
        .eq("device_code", data.device_code);

    if (error) {
        console.error("[device-code] approve update failed", {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        });
    }
    return !error;
}
