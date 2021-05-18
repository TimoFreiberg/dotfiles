{ config, lib, pkgs, ... }:

{
  imports = [
    ../common.nix
    ../roles/fish.nix
    ../roles/gnome3.nix
    ../roles/games.nix
    ../roles/perftools.nix
    ../filesystems/tf-desktop.nix
  ];

  networking = {
    hostName = "tf-desktop"; # Define your hostname.
    hostId = "7ba087ad";
    interfaces = {
        enp34s0.useDHCP = true;
    }
  };

  environment.systemPackages =
    let unstable = import <nixos-unstable> { config = config.nixpkgs.config; };
    in with pkgs; [ ];

  hardware.cpu.amd.updateMicrocode = true;

  ## HAHA LOL GNOME BULLSHIT ( - thx hawkw :'D )
  programs = {
    # Used specifically for its (quite magical) "copy as html" function.
    gnome-terminal.enable = true;
    # enable the correct perf tools for this kernel version
    perftools.enable = true;
  };
}
