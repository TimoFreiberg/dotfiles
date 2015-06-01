{ config, lib, pkgs, ... }:

{
  # # Define `nixPath` here so that included config files can conditionally add overlays.
  # nix.nixPath =
  #   # Prepend default nixPath values.
  #   options.nix.nixPath.default;

  #### Boot configuration ####
  boot = {
    loader = {
      # Use the systemd-boot EFI boot loader.
      systemd-boot.enable = true;
      efi.canTouchEfiVariables = true;
    };

    # Use the latest available linux kernel. I like to live dangerously!
    kernelPackages = pkgs.linuxPackages_latest;
  };

  #### Networking Configuration ####

  networking = {
    # networking.wireless.enable = true;  # Enables wireless support via wpa_supplicant.
    networkmanager.enable = true;

    # The global useDHCP flag is deprecated, therefore explicitly set to false here.
    # Per-interface useDHCP will be mandatory in the future, so this generated config
    # replicates the default behaviour.
    useDHCP = false;

    # Set those interfaces in machine files!
    # interfaces = {
    #   enp5s0.useDHCP = true;
    #   wlp4s0.useDHCP = true;
    # };

    # Configure network proxy if necessary
    # networking.proxy.default = "http://user:password@proxy:port/";
    # networking.proxy.noProxy = "127.0.0.1,localhost,internal.domain";

    # Open ports in the firewall.
    # networking.firewall.allowedTCPPorts = [ ... ];
    # networking.firewall.allowedUDPPorts = [ ... ];
    # Or disable the firewall altogether.
    # networking.firewall.enable = false;
    # FIXME limit SSH
  };

  # Select internationalisation properties.
  i18n.defaultLocale = "en_US.UTF-8";
  console = {
    keyMap = "us";
  };

  # Set your time zone.
  # time.timeZone = "Europe/Amsterdam";

  #### Programs & Packages ####

  # List packages installed in system profile. To search, run:
  # $ nix search wget
  environment.systemPackages = with pkgs;
    let unstable = import <nixos-unstable> { config = config.nixpkgs.config; };
    in [
      wget
      vim
      ddate
      testdisk
      git
      nano
      networkmanager
      networkmanagerapplet
      openssh
      bluedevil
      bluez
      file
    ];

  programs = {
    # Some programs need SUID wrappers, can be configured further or are
    # started in user sessions.
    mtr.enable = true;
    # programs.gnupg.agent = {
    #   enable = true;
    #   enableSSHSupport = true;
    #   pinentryFlavor = "gnome3";
    # }
  };

  # fonts.fonts = with pkgs; [ roboto ];

  #### Services ####

  services = {
    # List services that you want to enable:

    # Enable the OpenSSH daemon.
    openssh = {
      enable = false;
      # forwardX11 = true;
    };

    # Enable CUPS to print documents.
    printing.enable = true;

    # FIXME enable fstrim service in machine file
  };

  # Enable the Docker daemon.
  virtualisation.docker = {
    enable = true;
    # Docker appears to select `devicemapper` by default, which is not cool.
    storageDriver = "overlay2";
    # Prune the docker registry weekly.
    autoPrune.enable = true;
    extraOptions = ''
      --experimental
    '';
  };

  #### Hardware ####

  hardware.bluetooth.enable = true;

  # Enable sound.
  sound.enable = true;
  hardware.pulseaudio.enable = true;

  # Define a user account. Don't forget to set a password with ‘passwd’.
  users.users.tf = {
    isNormalUser = true;
    extraGroups = [
      "wheel" # Enable ‘sudo’ for the user.
      "networkmanager"
      "audio"
      "docker" # Enable docker.
      "wireshark" # of course i want to be in the wireshark group!
      "realtime"
    ];
    shell = pkgs.fish;
    #   openssh.authorizedKeys.keyFiles =
    #      [ "TODO" ];
  };

  nixpkgs.config.allowUnfree = true;
}
