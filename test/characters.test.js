import test from 'node:test';
import assert from 'node:assert/strict';
import { characterProfile, runningPose, trackPosition } from '../public/characters.js';
import { seedCategories } from '../seed.js';

test('all supplied nominees have stable original designs and the same artist keeps their identity across categories', () => {
  for (const category of seedCategories) {
    for (const nominee of category.nominees) {
      const profile = characterProfile(nominee);
      assert.deepEqual(characterProfile(structuredClone(nominee)), profile);
      assert.ok(profile.name && profile.color && profile.accessory && profile.hair && profile.title && profile.skin);
    }
  }
  const plaveArtist = seedCategories[0].nominees[0];
  const plaveSong = seedCategories[9].nominees[0];
  assert.deepEqual(characterProfile(plaveArtist), characterProfile(plaveSong));
  assert.notDeepEqual(characterProfile(plaveArtist), characterProfile(seedCategories[0].nominees[1]));
  const aespaAlbum = seedCategories[1].nominees[0];
  const aespaArtist = seedCategories[7].nominees[2];
  assert.deepEqual(characterProfile(aespaAlbum), characterProfile(aespaArtist));
});

test('running animation articulates opposite hips, arms and knees over time, not just translation', () => {
  const first = runningPose(0, 1234);
  const second = runningPose(.15, 1234);
  assert.notEqual(first.leftHip, second.leftHip);
  assert.notEqual(first.leftKnee, second.leftKnee);
  assert.notEqual(first.leftArm, second.leftArm);
  assert.notEqual(first.bob, second.bob);
  assert.ok(Math.abs(first.leftHip + first.rightHip) < 1e-10);
  assert.ok(Math.abs(first.leftArm + first.rightArm) < 1e-10);
  assert.equal(first.elbow, -.95);
  for (const value of Object.values(first)) assert.ok(Number.isFinite(value));
  assert.deepEqual(runningPose(3, 5), runningPose(3, 5));
});

test('position corresponds to votes rather than gait time, is bounded, and handles all-zero counts', () => {
  assert.equal(trackPosition(0, 0), -8);
  assert.equal(trackPosition(100, 100), 8);
  assert.equal(trackPosition(50, 100), 0);
  assert.equal(trackPosition(0, 100), -8);
  assert.equal(trackPosition(200, 100), 8);
  assert.ok(trackPosition(75, 100) > trackPosition(20, 100));
});
