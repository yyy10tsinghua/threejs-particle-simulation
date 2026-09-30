# Ballistic Gel

The demo combines an analytic projectile trajectory, a damped radial cavity,
and GPU local shape matching. Speed, density, and compliance start a fresh shot.
Pause freezes all three; Restart restores the original block. With Loop off,
the shot remains in its final state instead of firing again implicitly.

The default 400 m/s shot stops about 0.60 m into the 0.76 m block. A 150 m/s shot
stops about 0.143 m in; a 750 m/s shot perforates and continues at its residual
velocity in air. Real event time is display time divided by 900.

Each material station uses the analytic projectile passage time. A normalized
damped pulse expands a radial annulus, then returns it to a narrow permanent
channel. The inner gel/air surface is explicitly meshed and uses the same
passage and radius functions. The outer surface follows the GPU particles.
The block rests on two constrained supports. Particle contacts are disabled:
the prescribed radial map and local shape matching maintain separation without
an oversized projectile collider adding artificial momentum.

This is an illustrative model, not a validated prediction of wound ballistics.
The resistance coefficients retain the original demo's 400 m/s / 0.60 m anchor.
Cavity timing and width are chosen for a legible slow-motion demonstration.
The model has no projectile yaw, fragmentation, fracture, or two-way energy
transfer. The rendered projectile is enlarged 1.7 times for visibility.
The internal interface is composited after the outer shell to avoid duplicate
screen-space refraction. It is not a volumetric optical simulation.

Validation covers passage timing, slow/fast outcomes, free flight after exit,
step-size independence, reset, normalized cavity expansion/collapse, immutable
plastic reference coordinates, full-scene GPU stability, and browser controls.
