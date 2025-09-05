# Yoga Voice Assistant

## ✅ Completed Features
- **Basic TTS Integration**: Kokoro web ONNX model for text-to-speech ✅
- **Voice Command Recognition**: Speech-to-text with command parsing ✅
- **Basic App Structure**: React components and yoga flow logic ✅

## description 
an audio only yoga instructor, that can dynamically change its course of action throught the session. it should be calming, and positive.

## features
1. poses: there exist a main pose library
   1. there are desriptions on how to perform the pose
   2. there are instructions on how to make a pose easier or harder
   3. there are instructions about the muscles that practioner should be mindful about
   4. for poses that has two sides, the description should integrate the side (bring your left knee up vs right knee up)
2. flows: users will see a catalouge of flows, they choose one and it starts instructing what to do. states will come from a pose library. 
   1. they can create their own flows from pose library
   2. they can browse other people flows by adding their directory
3. variability: the flows shall not be rigid ✅ *Basic voice commands implemented*
   1. for user commands we use gemma 3, that had audio input capability, to make it easier for user to interact ✅ *Using Web Speech API instead (better for offline use)*
   2. user can ask to describe how to perform this pose, or opt for full description from now on in this flow, or all flows ✅ *Basic implementation done*
   3. user can ask to help make the pose easier or harder ✅ *Basic implementation done*
   4. user can ask to point out the muscles user should be mindful about
   5. user can ask to pause, continue, skip, or terminate the session ✅ *Basic implementation done*
   6. flow shouldn't start the moment user click start, it should start a countdown, or wait for user uttering "ready"
4. breaths: each pose specifies how many breaths should the user hold the pose. that is the total number of breaths
   1. user can increase/decrease inhale/exhale lengths by voice command, they can also mute this marker
   2. there should exist a breath count helper, i'm not sure yet about the marker, the marker can be one of these
      1. a slightly dissonant sound (a dissonnat chord dolving into a consonant in the end)
      2. a slightly detune note moving towards tonic
      3. a rising and falling brown noise (to mimic the breath sound) 
5. background noise: there should be random background sound, user can opt to mute this as well
   1. it can be one of these
      1. nature sounds that are close to the user (if user accepts the location request), or any nature sound, but not yoga specific nature sounds
         1. chirpping birds
         2. sea
         3. river
         4. rain
         5. wind
         6. whale
      2. city sounds
         1. busy streets
      3. synthetic calming sounds
         1. ADHD musics
         2. binarual beats
         3. ...
6. genderless voice: the voice that reads the instruction should be genderless, I have found a good formula for that in kokoro (af_nicole0.4 + am_liam0.4 + af_bella*0.2)
7. everything should work offline (execpt maybe getting community flows, poses, sounds, breaths, and the very beginning when we are caching the kokoro model, voices, and probably the gemma 3 model for stt)
8. cherry on top: notification system.


## old comments
app features: it is audio only, once you select a flow, it will go step by step and recite all the poses in correct timing. now do this, hold for 3 breaths. now do that.
meanwhile a very small speech recognition gets some small commands, like it's too easy/difficult, (follows by suggestion on how to do the pose easier, or more difficult), skip, pause, describe how to do (if selected to only utter the name of the pose by default), start and ready

in the background I want to play some noises, each time from a different part of the world. user can slect these. can be city noises, nature/forest/bird/water/sea wave noises, ... (there are archives for that, if we can use and refrence the archive would be great)

I also want to play some rhythmic noise/sound/beat (I'll come up with what it should be) so user can sync their breaths

I want to use kokoro web onnx model for tts (this is a new thing, you need to search for that)

(later I want to extend this app to include all sort of tasks that requirers sequential tasks being done in timely manner that can be slighlty controlled/derailed/... with simple commads from performer (like xigong, cooking from a recipe, assembling ikea, ....) but let's start with yoga first as I have the data ready)

the application should be in react without typescript, deployable via github actions in github pages

do not do things at one go, I won't understand and it won't end up a good application. build it gradually and semantically step by step. steps that I can understand and verify


af_nicole0.4 + am_liam0.4 + af_bella*0.2

another resource to check: http://www.yogadancer.com/Asana.shtml