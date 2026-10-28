"use client";

import { saveSettingsAction } from "@/lib/actions";
import { SETTING_FIELDS, type SettingField } from "@/lib/domain/settings";
import type { Settings } from "@/lib/domain/types";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SettingsForm({ settings }: { settings: Settings }) {
  const groups = [...new Set(SETTING_FIELDS.map((field) => field.group))];
  return (
    <form action={saveSettingsAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
          Shop address
          <Input name="shopAddress" defaultValue={settings.shopAddress} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Shop latitude
          <Input name="shopLat" type="number" step="0.000001" defaultValue={settings.shopLat} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Shop longitude
          <Input name="shopLng" type="number" step="0.000001" defaultValue={settings.shopLng} />
        </label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
          Email for owner notices
          <Input name="ownerNotifyEmail" type="email" defaultValue={settings.ownerNotifyEmail} placeholder="Your inbox" />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="rrpCertified" defaultChecked={settings.rrpCertified} />
          RRP certified (lead-safe). The quote form no longer asks the year the home was built; the crew checks the paint on site.
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="premiumEnabled" defaultChecked={settings.premiumEnabled} />
          Area premium on
        </label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
          Premium counties, separated by commas
          <Input name="premiumCounties" defaultValue={settings.premiumCounties.join(", ")} />
        </label>
      </div>
      <p className="text-sm text-muted">
        Amounts marked “example” are starting public ranges. Replace them with your prices. Helper pay, travel, the cancel fee, and the deposit rule are your rules and can be changed here too. The Michigan builder threshold stays at ${settings.builderThreshold} and is not a price.
      </p>
      <Tabs defaultValue={groups[0]}>
        <TabsList>
          {groups.map((group) => (
            <TabsTrigger key={group} value={group}>
              {group}
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map((group) => (
          <TabsContent key={group} value={group} forceMount className="data-[state=inactive]:hidden">
            <div className="grid gap-3 sm:grid-cols-2">
              {SETTING_FIELDS.filter((field) => field.group === group).map((field) => (
                <RateField key={field.key} field={field} value={Number(settings[field.key])} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <SubmitButton>Save rates and rules</SubmitButton>
    </form>
  );
}

function RateField({ field, value }: { field: SettingField; value: number }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={field.key}>
        {field.label}
        {field.example ? <span className="ml-2 font-normal text-copper">example</span> : null}
      </Label>
      <Input id={field.key} name={field.key} type="number" step={field.step} defaultValue={value} />
    </div>
  );
}
