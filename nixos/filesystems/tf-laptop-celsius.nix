{ config, pkgs, lib, ... }:

{
  boot = {
    supportedFilesystems = [ "zfs" "xfs" ];
    kernelParams = [ "elevator=none" ];
    # zfs.enableUnstable = true;
  };

  # ZFS configuration
  services.zfs = {
    # Enable TRIM
    # trim.enable = true;
    # Enable automatic scrubbing and snapshotting.
    autoScrub.enable = true;
    autoSnapshot = {
      enable = true;
      frequent = 4;
      daily = 3;
      weekly = 2;
      monthly = 2;
    };
  };

 fileSystems."/" =
    { device = "rpool/root/nixos";
      fsType = "zfs";
    };

  fileSystems."/home" =
    { device = "rpool/home";
      fsType = "zfs";
    };

  fileSystems."/boot" =
    { device = "/dev/disk/by-uuid/4D1D-A44E";
      fsType = "vfat";
    };

  fileSystems."/nix" =
    { device = "rpool/nix";
      fsType = "zfs";
    };

  swapDevices = [ ];
}
