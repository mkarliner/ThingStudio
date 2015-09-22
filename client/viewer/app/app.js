// Template.appViewerBody.registerElement('app-body');
// Template.appScreen.registerElement('app-screen');

Template.ViewApp.helpers({
	screenlist: function(){
		// console.log("screens")
		return Screens.find({isWidget: false})
	},
	screenparams: function(){
		// console.log("SP", this);
		return {appid: this.appId, _id: this._id}
	}
});

// $.Velocity.RegisterEffect('transition.pushLeftIn', {
//   defaultDuration: 5000,
//   calls: [
//     [
//       {
//         translateX: ['0%', '-100%'],
//         translateZ: 0,
//         easing: "ease-in-out",
//         opacity: [1, 0]
//       }
//     ]
//   ]
// });
//
// $.Velocity.RegisterEffect('transition.pushLeftOut', {
//   defaultDuration: 5000,
//   calls: [
//     [
//       {
//         translateX: ['0%', '100%'],
//         translateZ: 0,
//         easing: "ease-in-out",
//         opacity: [0, 1]
//       }
//     ]
//   ]
// });

Transitioner.transition({
    fromRoute: 'ViewApp',
    toRoute: 'ViewScreen',
    velocityAnimation: {
				in: 'transition.slideRightIn',
        out: 'transition.fadeOut'
    }
})

Transitioner.transition({
    fromRoute: 'ViewScreen',
    toRoute: 'ViewApp',
    velocityAnimation: {
				in: 'transition.slideUpBigIn',
        out: 'transition.fadeOut'
    }
})


// Transitioner.transition({
//     fromRoute: 'ViewScreen',
//     toRoute: 'ViewApp',
//     velocityAnimation: {
//         in: 'transition.pushLeftIn',
//         out: 'transition.pushLeftOut'
//     }
// })
