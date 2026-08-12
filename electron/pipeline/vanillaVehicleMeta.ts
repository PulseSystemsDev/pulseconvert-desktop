import vanillaVehiclesMeta from './data/vanilla-vehicles-meta.json';

export interface VanillaVehicleMeta {
  name: string;
  handlingId: string;
  layout: string;
  vehicleMakeName: string;
  vehicleClass: string;
  type: string;
  plateType: string;
  dashboardType: string;
  wheelType: string;
}

// [name, handlingId, layout, vehicleMakeName, vehicleClass, type, plateType, dashboardType,
// wheelType] tuples (DurtyFree/gta-v-data-dumps vehicles.json, trimmed to just the fields a
// vehicles.meta <Item> needs). Field names and the VC_/VEHICLE_TYPE_/VPT_/VDT_/VWT_ prefixes
// verified against a real vanilla vehicles.meta dump (mule3: every field matched exactly).
const BY_NAME = new Map<string, VanillaVehicleMeta>(
  (vanillaVehiclesMeta as [string, string, string, string, string, string, string, string, string][]).map(
    ([name, handlingId, layout, vehicleMakeName, vehicleClass, type, plateType, dashboardType, wheelType]) => [
      name,
      { name, handlingId, layout, vehicleMakeName, vehicleClass, type, plateType, dashboardType, wheelType },
    ]
  )
);

export function lookupVanillaVehicle(name: string): VanillaVehicleMeta | null {
  return BY_NAME.get(name.toLowerCase()) ?? null;
}

/**
 * Builds a complete <Item> for vehicles.meta from a verified-real vanilla template (GTA5's own
 * mule3 entry, confirmed field-for-field against a real game data dump). Only the fields that
 * actually vary per-vehicle are substituted in; every other field (camera names, IK offsets,
 * damage scale, etc.) is left as a verified-real default - confirmed via the same dump that
 * Rockstar itself reuses generic "DEFAULT_"/"STANDARD_" values for these across many vehicles,
 * not vehicle-specific ones, so none of this affects whether the vehicle registers or loads.
 */
export function buildVehiclesMetaItem(modelName: string, vanilla: VanillaVehicleMeta): string {
  const gameName = modelName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  return `    <Item>
      <modelName>${modelName}</modelName>
      <txdName>${modelName}</txdName>
      <handlingId>${vanilla.handlingId}</handlingId>
      <gameName>${gameName}</gameName>
      <vehicleMakeName>${vanilla.vehicleMakeName}</vehicleMakeName>
      <expressionDictName>null</expressionDictName>
      <expressionName>null</expressionName>
      <animConvRoofDictName>null</animConvRoofDictName>
      <animConvRoofName>null</animConvRoofName>
      <animConvRoofWindowsAffected />
      <ptfxAssetName>null</ptfxAssetName>
      <audioNameHash />
      <layout>${vanilla.layout}</layout>
      <coverBoundOffsets>STANDARD_COVER_OFFSET_INFO</coverBoundOffsets>
      <explosionInfo>EXPLOSION_INFO_DEFAULT</explosionInfo>
      <scenarioLayout />
      <cameraName>DEFAULT_FOLLOW_VEHICLE_CAMERA</cameraName>
      <aimCameraName>DEFAULT_THIRD_PERSON_VEHICLE_AIM_CAMERA</aimCameraName>
      <bonnetCameraName>DEFAULT_VEHICLE_BONNET_CAMERA</bonnetCameraName>
      <povCameraName>DEFAULT_POV_CAMERA</povCameraName>
      <FirstPersonDriveByIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonDriveByUnarmedIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonProjectileDriveByIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonProjectileDriveByPassengerIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonProjectileDriveByRearLeftIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonProjectileDriveByRearRightIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonDriveByLeftPassengerIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonDriveByRightPassengerIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonDriveByRightRearPassengerIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonDriveByLeftPassengerUnarmedIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonDriveByRightPassengerUnarmedIKOffset x="0.000000" y="0.000000" z="0.000000" />
      <FirstPersonMobilePhoneOffset x="0.123000" y="0.219000" z="0.453000" />
      <FirstPersonPassengerMobilePhoneOffset x="0.171000" y="0.321000" z="0.433000" />
      <FirstPersonMobilePhoneSeatIKOffset />
      <PovCameraOffset x="0.000000" y="-0.200000" z="0.600000" />
      <PovCameraVerticalAdjustmentForRollCage value="0.000000" />
      <PovPassengerCameraOffset x="0.000000" y="0.040000" z="0.130000" />
      <PovRearPassengerCameraOffset x="0.000000" y="0.040000" z="0.130000" />
      <vfxInfoName>VFXVEHICLEINFO_CAR_GENERIC</vfxInfoName>
      <shouldUseCinematicViewMode value="true" />
      <shouldCameraTransitionOnClimbUpDown value="false" />
      <shouldCameraIgnoreExiting value="false" />
      <AllowPretendOccupants value="true" />
      <AllowJoyriding value="true" />
      <AllowSundayDriving value="true" />
      <AllowBodyColorMapping value="true" />
      <wheelScale value="0.279000" />
      <wheelScaleRear value="0.279000" />
      <dirtLevelMin value="0.000000" />
      <dirtLevelMax value="0.700000" />
      <envEffScaleMin value="0.000000" />
      <envEffScaleMax value="1.000000" />
      <envEffScaleMin2 value="0.000000" />
      <envEffScaleMax2 value="1.000000" />
      <damageMapScale value="0.500000" />
      <damageOffsetScale value="0.500000" />
      <diffuseTint value="0x00FFFFFF" />
      <steerWheelMult value="1.000000" />
      <HDTextureDist value="5.000000" />
      <lodDistances content="float_array">
        15.000000
        30.000000
        70.000000
        140.000000
        500.000000
        500.000000
      </lodDistances>
      <identicalModelSpawnDistance value="20" />
      <maxNumOfSameColor value="10" />
      <defaultBodyHealth value="1000.000000" />
      <pretendOccupantsScale value="1.000000" />
      <visibleSpawnDistScale value="1.000000" />
      <trackerPathWidth value="2.000000" />
      <weaponForceMult value="1.000000" />
      <frequency value="10" />
      <swankness>SWANKNESS_1</swankness>
      <maxNum value="5" />
      <flags>FLAG_NO_BOOT</flags>
      <type>${vanilla.type}</type>
      <plateType>${vanilla.plateType}</plateType>
      <dashboardType>${vanilla.dashboardType}</dashboardType>
      <vehicleClass>${vanilla.vehicleClass}</vehicleClass>
      <wheelType>${vanilla.wheelType}</wheelType>
      <trailers />
      <additionalTrailers />
      <drivers />
      <extraIncludes />
      <doorsWithCollisionWhenClosed />
      <driveableDoors />
      <bumpersNeedToCollideWithMap value="false" />
      <needsRopeTexture value="false" />
      <requiredExtras />
      <rewards />
      <cinematicPartCamera />
      <NmBraceOverrideSet>Truck</NmBraceOverrideSet>
      <buoyancySphereOffset x="0.000000" y="0.000000" z="0.000000" />
      <buoyancySphereSizeScale value="1.000000" />
      <pOverrideRagdollThreshold type="NULL" />
      <firstPersonDrivebyData />
    </Item>
`;
}
